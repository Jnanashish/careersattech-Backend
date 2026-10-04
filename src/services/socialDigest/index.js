const JobV2 = require("../../modules/jobsV2/jobsV2.model");
const CompanyV2 = require("../../modules/companiesV2/companiesV2.model");
const logger = require("../../utils/logger");
const { send, esc } = require("../../utils/telegram");
const { isBestToPost } = require("./bestToPost");
const { buildCaption } = require("./captions/captionBuilder");
const { buildWhatsAppMessage } = require("./captions/whatsapp");

// Daily social digest: the top best-to-post jobs, plus a ready-to-paste
// Instagram caption and WhatsApp message, posted to the socialDigest Telegram
// channel. Every job sent is stamped with socialDigestSentAt so it is never
// sent twice.

const DIGEST_SIZE = 6;
const DEFAULT_LOOKBACK_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;

// The lookback window already bounds the pool; the cap only stops a
// misconfigured window from pulling the whole collection into memory.
const CANDIDATE_CAP = 500;

// The public site the links point at. Pinned in code like the Telegram chat
// IDs — a fixed property of this deployment — rather than read from SITE_URL,
// which feeds the blog RSS feed and is not guaranteed to hold the public domain.
const SITE_URL = "https://careersat.tech";

// Best-to-post is pass/fail, so "top" needs an order: the strongest company
// type first, newest first within a type. Every type isKnownCompany accepts has
// a rank here.
const COMPANY_TYPE_RANK = { bigtech: 0, unicorn: 1, product: 2, mnc: 3 };

function getLookbackHours() {
    const n = Number(process.env.SOCIAL_DIGEST_LOOKBACK_HOURS);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_LOOKBACK_HOURS;
}

function getDigestTimezone() {
    return process.env.SOCIAL_DIGEST_TZ || "Asia/Kolkata";
}

const jobUrl = (job) => `${SITE_URL}/jobs/${job.slug}`;

const rankOf = (job) =>
    COMPANY_TYPE_RANK[job.company?.companyType] ?? Number.MAX_SAFE_INTEGER;

function compareCandidates(a, b) {
    return (
        rankOf(a) - rankOf(b) ||
        new Date(b.datePosted) - new Date(a.datePosted) ||
        String(b._id).localeCompare(String(a._id))
    );
}

/**
 * The jobs the next digest would send: published, live, posted inside the
 * lookback window, never sent before, and best-to-post — ranked and capped.
 *
 * The window is measured on datePosted, the date the public site sorts by.
 * With a daily run and the default 24h window, consecutive runs tile the
 * timeline exactly: a job that misses today's top six is not offered tomorrow.
 */
async function selectDigestJobs({ now = new Date(), lookbackHours = getLookbackHours() } = {}) {
    const since = new Date(now.getTime() - lookbackHours * HOUR_MS);

    const candidates = await JobV2.find({
        status: "published",
        deletedAt: null,
        socialDigestSentAt: null,
        datePosted: { $gte: since },
        $or: [{ validThrough: null }, { validThrough: { $gt: now } }],
    })
        .select("_id title slug companyName company batch degree experience jobLocation employmentType applyLink datePosted")
        .populate({ path: "company", model: CompanyV2, select: "companyName logo companyType" })
        .sort({ datePosted: -1 })
        .limit(CANDIDATE_CAP)
        .lean();

    return candidates.filter(isBestToPost).sort(compareCandidates).slice(0, DIGEST_SIZE);
}

function formatDigestDate(now) {
    return new Intl.DateTimeFormat("en-IN", {
        timeZone: getDigestTimezone(),
        weekday: "short",
        day: "numeric",
        month: "short",
    }).format(now);
}

function buildJobsListMessage(jobs, { now, lookbackHours }) {
    const noun = jobs.length === 1 ? "job" : "jobs";
    const lines = [
        `📣 <b>Top ${jobs.length} ${noun} to post — ${esc(formatDigestDate(now))}</b>`,
        `Best-to-post picks from the last ${lookbackHours}h. The Instagram caption ` +
            `and WhatsApp message follow — long-press either one to copy it.`,
    ];
    jobs.forEach((job, i) => {
        const batch = Array.isArray(job.batch) && job.batch.length
            ? `\nBatch ${esc(job.batch.join(", "))}`
            : "";
        lines.push(
            "",
            `${i + 1}. <b>${esc(job.companyName)}</b> — ${esc(job.title)}${batch}\n${esc(jobUrl(job))}`
        );
    });
    return lines.join("\n");
}

/**
 * Three messages, in posting order: the job list, the Instagram caption, the
 * WhatsApp message. The two captions go out alone and unformatted (escaped
 * only because utils/telegram sends with parse_mode HTML), so a long-press →
 * Copy yields exactly the text to paste.
 *
 * Six jobs keep each message far below the 3900-character cap utils/telegram
 * truncates at — and a truncated caption would be pasted with the cut in it.
 */
function buildDigestMessages(jobs, { now = new Date(), lookbackHours = getLookbackHours() } = {}) {
    return [
        buildJobsListMessage(jobs, { now, lookbackHours }),
        esc(buildCaption({ jobs })),
        esc(buildWhatsAppMessage(jobs, { siteUrl: SITE_URL })),
    ];
}

const summarizeJob = (job) => ({
    _id: job._id,
    slug: job.slug,
    title: job.title,
    companyName: job.companyName,
    companyType: job.company?.companyType || null,
    datePosted: job.datePosted,
    url: jobUrl(job),
});

// One real send at a time per process, so the 16:00 cron and the admin
// "Send now" button cannot both post the same jobs. Dry runs skip the lock:
// they neither send nor stamp.
let sending = false;

/**
 * Pick, build, send, stamp.
 *
 * Jobs are stamped only after all three messages are accepted. If Telegram
 * refuses one, nothing is stamped and the same jobs go out on the next run —
 * a repeated message beats a digest that silently never arrived.
 *
 * Never throws for an expected outcome; `reason` says why nothing was sent:
 *   "no-eligible-jobs" | "telegram-failed" | "already-running" | null (sent / dry run)
 *
 * @param {object} [opts]
 * @param {string} [opts.trigger] "cron" | "manual" | "preview" — for the logs
 * @param {boolean} [opts.dryRun] build the messages, send and stamp nothing
 * @param {Date} [opts.now]
 */
async function runSocialDigest({ trigger = "manual", dryRun = false, now = new Date() } = {}) {
    if (!dryRun && sending) {
        return { sent: false, dryRun, reason: "already-running", jobs: [], messages: [] };
    }
    if (!dryRun) sending = true;

    try {
        const lookbackHours = getLookbackHours();
        const picked = await selectDigestJobs({ now, lookbackHours });
        const jobs = picked.map(summarizeJob);
        const base = { dryRun, lookbackHours, jobs };

        if (!picked.length) {
            // Same rule as the scraper's jobs channel: a "0 jobs" post every
            // quiet day trains people to ignore the channel.
            logger.info(`[digest] trigger=${trigger} no best-to-post jobs in the last ${lookbackHours}h — nothing to send`);
            return { ...base, sent: false, reason: "no-eligible-jobs", messages: [] };
        }

        const messages = buildDigestMessages(picked, { now, lookbackHours });

        if (dryRun) return { ...base, sent: false, reason: null, messages };

        for (const text of messages) {
            // send() never throws; false means Telegram refused the message and
            // utils/telegram has logged its reason.
            if (!(await send(text, "socialDigest"))) {
                logger.error(
                    `[digest] trigger=${trigger} Telegram refused a digest message — ` +
                        `${picked.length} job(s) left unsent for the next run`
                );
                return { ...base, sent: false, reason: "telegram-failed", messages };
            }
        }

        await JobV2.updateMany(
            { _id: { $in: picked.map((j) => j._id) } },
            { $set: { socialDigestSentAt: now } }
        );

        logger.info(
            `[digest] trigger=${trigger} sent ${picked.length} job(s): ${picked.map((j) => j.slug).join(", ")}`
        );
        return { ...base, sent: true, reason: null, messages, sentAt: now };
    } finally {
        if (!dryRun) sending = false;
    }
}

module.exports = {
    runSocialDigest,
    selectDigestJobs,
    buildDigestMessages,
    getDigestTimezone,
    DIGEST_SIZE,
    SITE_URL,
};
