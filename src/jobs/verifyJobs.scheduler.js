const cron = require("node-cron");
const logger = require("../utils/logger");
const JobV2 = require("../modules/jobsV2/jobsV2.model");
const JobClickV2 = require("../modules/jobsV2/jobClickV2.model");
const { verifyJob } = require("../services/jobVerifier");
const emailReporter = require("../services/jobVerifier/emailReporter");
const { notifyJobCleanup } = require("../utils/telegram");

const DEFAULT_CRON = "0 */12 * * *"; // every 12 hours — 00:00 and 12:00
const DEFAULT_CONCURRENCY = 5;
const PER_DOMAIN_GAP_MS = 2_000;

function getConcurrency() {
    const n = Number(process.env.VERIFY_JOBS_CONCURRENCY);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_CONCURRENCY;
}

function isDryRun() {
    return process.env.VERIFY_JOBS_DRY_RUN === "true";
}

let pLimitLib;
function loadPLimit() {
    if (pLimitLib) return pLimitLib;
    try {
        pLimitLib = require("p-limit");
        if (pLimitLib && typeof pLimitLib.default === "function") {
            pLimitLib = pLimitLib.default;
        }
    } catch (_) {
        pLimitLib = makeFallbackLimit;
    }
    return pLimitLib;
}

/** Minimal p-limit fallback if the package isn't installed. */
function makeFallbackLimit(concurrency) {
    let active = 0;
    const queue = [];
    const next = () => {
        if (active >= concurrency || queue.length === 0) return;
        active++;
        const { fn, resolve, reject } = queue.shift();
        Promise.resolve()
            .then(fn)
            .then((v) => {
                active--;
                resolve(v);
                next();
            })
            .catch((e) => {
                active--;
                reject(e);
                next();
            });
    };
    return (fn) =>
        new Promise((resolve, reject) => {
            queue.push({ fn, resolve, reject });
            next();
        });
}

function hostnameOf(url) {
    try {
        return new URL(url).hostname.toLowerCase();
    } catch (_) {
        return "_invalid";
    }
}

/**
 * Per-hostname throttle: every call to `gate(host)` resolves only after at
 * least PER_DOMAIN_GAP_MS has passed since the previous call for that host.
 * Implemented as a chain of promises keyed by host so all serialization is
 * intra-host (no global lock).
 */
function makeDomainThrottle() {
    const lastCallAt = new Map(); // host -> ms timestamp of last allowed start
    const chains = new Map(); // host -> Promise<void>

    return function gate(host) {
        const prev = chains.get(host) || Promise.resolve();
        const next = prev.then(async () => {
            const now = Date.now();
            const last = lastCallAt.get(host) || 0;
            const wait = Math.max(0, last + PER_DOMAIN_GAP_MS - now);
            if (wait > 0) await new Promise((r) => setTimeout(r, wait));
            lastCallAt.set(host, Date.now());
        });
        chains.set(host, next);
        return next;
    };
}

function buildJobUpdate(job, result, now) {
    const set = {
        "verification.lastCheckedAt": now,
        "verification.lastCheckResult": result.result,
        "verification.lastCheckReason": result.reason,
        "verification.lastCheckStatusCode": result.statusCode ?? null,
        "verification.lastCheckFinalUrl": result.finalUrl ?? null,
    };
    const update = { $set: set };

    if (result.result === "expired") {
        set.status = "archived";
        set.archivedAt = now;
        set.archivedReason = "auto-verification-expired";
    }

    return {
        updateOne: {
            filter: { _id: job._id },
            update,
        },
    };
}

/**
 * Run the verifier across the selected jobs.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun]
 * @param {number} [opts.limit]
 * @param {string|null} [opts.jobId]
 * @param {string|null} [opts.slug]
 * @param {boolean} [opts.skipEmail]
 * @param {boolean} [opts.deleteExpired] hard-delete confirmed-expired jobs
 *   instead of archiving them. IRREVERSIBLE — the documents and their click
 *   events are removed. Opt-in, and only the 12-hourly cron opts in; the admin
 *   panel's manual scan archives into the reviewable flagged queue instead.
 *   Suppressed by dryRun like every other write.
 * @param {string} [opts.trigger]  "cron" | "manual"
 * @returns {Promise<object>} summary
 */
async function runVerification(opts = {}) {
    const startedAt = new Date();
    const dryRun = opts.dryRun ?? isDryRun();
    const skipEmail = !!opts.skipEmail;
    const deleteExpired = !!opts.deleteExpired;
    const trigger = opts.trigger || "manual";

    logger.info(
        `[verify] start trigger=${trigger} dryRun=${dryRun} deleteExpired=${deleteExpired} limit=${opts.limit || "all"} jobId=${
            opts.jobId || "-"
        } slug=${opts.slug || "-"}`
    );

    const filter = {
        status: "published",
        deletedAt: null,
        applyLink: { $exists: true, $nin: [null, ""] },
    };
    if (opts.jobId) filter._id = opts.jobId;
    if (opts.slug) filter.slug = opts.slug;

    let cursor = JobV2.find(filter)
        .select("_id slug title companyName applyLink verification")
        .sort({ "verification.lastCheckedAt": 1 });
    if (opts.limit && Number(opts.limit) > 0) cursor = cursor.limit(Number(opts.limit));
    const jobs = await cursor.lean();

    const pLimit = loadPLimit();
    const limiter = pLimit(getConcurrency());
    const throttle = makeDomainThrottle();

    const archivedJobs = [];
    const deletedJobs = [];
    const bulkOps = [];
    let activeCount = 0;
    let expiredCount = 0;

    await Promise.all(
        jobs.map((job) =>
            limiter(async () => {
                const host = hostnameOf(job.applyLink);
                await throttle(host);

                const result = await verifyJob(job);

                logger.info(
                    `[verify] ${job._id} ${job.slug} → ${result.result} (${result.reason}) ${result.durationMs}ms`
                );

                const now = new Date();

                if (result.result === "expired") {
                    expiredCount++;
                    const entry = {
                        _id: job._id,
                        slug: job.slug,
                        title: job.title,
                        companyName: job.companyName,
                        applyLink: job.applyLink,
                        reason: result.reason,
                    };
                    archivedJobs.push(entry);
                    // A document about to be removed needs no verification
                    // stamp, so skip the write rather than update-then-delete.
                    if (deleteExpired) deletedJobs.push(entry);
                    else bulkOps.push(buildJobUpdate(job, result, now));
                } else {
                    activeCount++;
                    bulkOps.push(buildJobUpdate(job, result, now));
                }
            })
        )
    );

    if (!dryRun && bulkOps.length > 0) {
        const res = await JobV2.bulkWrite(bulkOps, { ordered: false });
        logger.info(
            `[verify] bulkWrite: matched=${res.matchedCount || 0} modified=${res.modifiedCount || 0}`
        );
    } else if (dryRun) {
        logger.info(`[verify] dry-run: would have written ${bulkOps.length} updates`);
    }

    // Hard delete. Irreversible, so it is reached only when the caller opted in
    // via `deleteExpired` AND the verifier returned "expired" — a definite
    // signal (404/410, closed-posting phrase, or a collapse onto the careers
    // homepage). Timeouts, 5xx, bot walls and empty bodies all classify as
    // "active" upstream and can never land here.
    let deletedCount = 0;
    let clickEventsDeleted = 0;
    if (deletedJobs.length > 0 && !dryRun) {
        const ids = deletedJobs.map((j) => j._id);
        const del = await JobV2.deleteMany({ _id: { $in: ids } });
        deletedCount = del.deletedCount || 0;

        // Click events are analytics-only; failing to clear them must not turn
        // a completed delete into a failed run. Mirrors deleteFlaggedJobs.
        try {
            const clicks = await JobClickV2.deleteMany({ job: { $in: ids } });
            clickEventsDeleted = clicks.deletedCount || 0;
        } catch (clickErr) {
            logger.error(
                `[verify] failed to clear click events for deleted jobs: ${clickErr.message}`
            );
        }

        logger.info(
            `[verify] hard-deleted ${deletedCount} expired job(s), ${clickEventsDeleted} click event(s)`
        );
    } else if (deletedJobs.length > 0 && dryRun) {
        logger.info(`[verify] dry-run: would have deleted ${deletedJobs.length} expired job(s)`);
    }

    const completedAt = new Date();
    const durationMs = completedAt - startedAt;

    const summary = {
        trigger,
        dryRun,
        deleteExpired,
        startedAt,
        completedAt,
        durationMs,
        totalChecked: jobs.length,
        activeCount,
        expiredCount,
        // Every job classified expired this run, whatever was done with it.
        // Named for the archive path that predates deletion; the email and the
        // Telegram summary read `deleteExpired` to label it correctly.
        archivedJobs,
        deletedJobs,
        deletedCount,
        clickEventsDeleted,
    };

    logger.info(
        `[verify] Run complete. checked=${summary.totalChecked} active=${activeCount} expired=${expiredCount} ` +
            `${deleteExpired ? `deleted=${deletedCount}` : `archived=${expiredCount}`} duration=${durationMs}ms`
    );

    if (!skipEmail) {
        await emailReporter.sendSummary(summary, { dryRun });
    }

    return summary;
}

/**
 * Archive time-expired jobs.
 *
 * "Expired" here matches exactly what the public API reports as `isExpired`:
 * a published job whose `validThrough` date has passed. Such jobs are already
 * hidden from public listings (the list/detail read filters on validThrough)
 * but still sit at status:"published" in the DB. This sweep flips them to
 * status:"archived" so their stored state matches what the API already
 * considers expired.
 *
 * Archive only — never deletes (no deletedAt), and only touches genuinely
 * expired jobs. Distinct from the link-verifier, which archives *dead-link*
 * jobs; this one is a pure date-based DB sweep with no outbound requests.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun]
 * @returns {Promise<{ archived: number, matched: number, dryRun: boolean, checkedAt: Date }>}
 */
async function archiveExpiredJobs(opts = {}) {
    const dryRun = opts.dryRun ?? isDryRun();
    const now = new Date();

    const filter = {
        status: "published",
        deletedAt: null,
        validThrough: { $ne: null, $lte: now },
    };

    if (dryRun) {
        const matched = await JobV2.countDocuments(filter);
        logger.info(`[expire] dry-run: would archive ${matched} expired job(s)`);
        return { archived: 0, matched, dryRun: true, checkedAt: now };
    }

    const res = await JobV2.updateMany(filter, {
        $set: {
            status: "archived",
            archivedAt: now,
            archivedReason: "auto-expired-validThrough",
        },
    });

    const archived = res.modifiedCount || 0;
    logger.info(
        `[expire] archived ${archived} expired job(s) (matched=${res.matchedCount || 0}, validThrough <= now)`
    );
    return { archived, matched: res.matchedCount || 0, dryRun: false, checkedAt: now };
}

function init() {
    if (process.env.VERIFY_JOBS_ENABLED !== "true") {
        logger.info("[verify] VERIFY_JOBS_ENABLED is not 'true' — cron NOT scheduled");
        return;
    }
    const schedule = process.env.VERIFY_JOBS_CRON || DEFAULT_CRON;
    if (!cron.validate(schedule)) {
        logger.error(`[verify] invalid VERIFY_JOBS_CRON: "${schedule}" — cron NOT scheduled`);
        return;
    }
    const timezone = process.env.VERIFY_JOBS_TZ || "Asia/Kolkata";
    logger.info(`[verify] scheduling cron "${schedule}" (tz=${timezone})`);

    cron.schedule(
        schedule,
        async () => {
            // Twice-daily maintenance. Two passes, in this order:
            //
            //   1. archiveExpiredJobs — pure date sweep. Jobs past their stated
            //      validThrough become "archived", which drops them out of the
            //      published set. They are NOT deleted, and because pass 2 only
            //      looks at published jobs, they are not link-checked either.
            //   2. runVerification — fetches each remaining published job's
            //      apply link, oldest-checked first, and hard-deletes the ones
            //      the verifier confirms dead.
            //
            // Neither pass throwing may skip the Telegram report: the deleted
            // count is the only record of an irreversible operation.
            let expiryArchived = 0;
            let summary = null;
            let failure = null;

            try {
                const expiry = await archiveExpiredJobs();
                expiryArchived = expiry.archived;
                logger.info(`[verify] expiry sweep archived ${expiry.archived} job(s)`);
            } catch (err) {
                logger.error(`[expire] cron sweep failed: ${err.stack || err.message}`);
                failure = err;
            }

            try {
                summary = await runVerification({ trigger: "cron", deleteExpired: true });
            } catch (err) {
                logger.error(`[verify] cron run failed: ${err.stack || err.message}`);
                failure = err;
            }

            // Fire-and-forget by contract — notifyJobCleanup never throws.
            await notifyJobCleanup({
                deletedCount: summary?.deletedCount ?? 0,
                clickEventsDeleted: summary?.clickEventsDeleted ?? 0,
                totalChecked: summary?.totalChecked ?? 0,
                durationMs: summary?.durationMs ?? 0,
                dryRun: summary?.dryRun ?? isDryRun(),
                deletedJobs: summary?.deletedJobs ?? [],
                expiryArchived,
                error: failure,
            });
        },
        { timezone }
    );
}

module.exports = {
    init,
    runVerification,
    archiveExpiredJobs,
    _internals: {
        buildJobUpdate,
        hostnameOf,
        makeDomainThrottle,
        PER_DOMAIN_GAP_MS,
    },
};
