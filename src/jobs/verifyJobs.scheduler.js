const cron = require("node-cron");
const logger = require("../utils/logger");
const JobV2 = require("../modules/jobsV2/jobsV2.model");
const JobClickV2 = require("../modules/jobsV2/jobClickV2.model");
const { verifyJob } = require("../services/jobVerifier");
const emailReporter = require("../services/jobVerifier/emailReporter");
const { notifyJobCleanup } = require("../utils/telegram");

const DEFAULT_CRON = "0 0 * * *"; // once a day at 00:00 in VERIFY_JOBS_TZ
const DEFAULT_CONCURRENCY = 5;
const PER_DOMAIN_GAP_MS = 2_000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Stamped on every job the date sweep archives, and the marker the delete
// sweep uses to recognise its own earlier output. A job archived by hand
// through the admin panel carries a different reason (and a deletedAt), so the
// automated delete never picks it up.
const AUTO_EXPIRED_REASON = "auto-expired-validThrough";

function getConcurrency() {
    const n = Number(process.env.VERIFY_JOBS_CONCURRENCY);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_CONCURRENCY;
}

function isDryRun() {
    return process.env.VERIFY_JOBS_DRY_RUN === "true";
}

/**
 * Days a date-expired job is kept before the hard delete. 0 — the default —
 * deletes it on the first daily run after `validThrough` passes. A positive
 * value leaves it archived for that long first, so a mistyped date can still
 * be spotted and restored before the document is gone.
 */
function getExpiryGraceDays() {
    const n = Number(process.env.EXPIRED_JOBS_GRACE_DAYS);
    return Number.isFinite(n) && n > 0 ? n : 0;
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
 *   events are removed. Opt-in, and only the daily cron opts in; the admin
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
 * Archive time-expired jobs — the grace-window half of the date sweep.
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
 * Ordering note: `deleteExpiredJobs` runs FIRST in the cron, so all that is
 * left for this pass is whatever expired too recently to be past the grace
 * cutoff. With the default grace of 0 that set is empty and this matches
 * nothing — it only does real work once EXPIRED_JOBS_GRACE_DAYS is set.
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
            archivedReason: AUTO_EXPIRED_REASON,
        },
    });

    const archived = res.modifiedCount || 0;
    logger.info(
        `[expire] archived ${archived} expired job(s) (matched=${res.matchedCount || 0}, validThrough <= now)`
    );
    return { archived, matched: res.matchedCount || 0, dryRun: false, checkedAt: now };
}

/**
 * Hard-delete time-expired jobs. IRREVERSIBLE.
 *
 * "Expired" is the same date contract the public reads already honour: a job
 * whose stated `validThrough` has passed. Those jobs are invisible to the
 * public API the moment the date rolls over; this sweep takes them out of
 * Mongo for good, together with their JobClickV2 events.
 *
 * Scope is deliberately narrow. A job goes only when `validThrough` is set and
 * at or before the cutoff AND it is either still `published` or was archived by
 * this same automation (`archivedReason === AUTO_EXPIRED_REASON` — which is how
 * the backlog from the archive-only era gets cleared). Drafts, paused jobs,
 * admin-archived jobs and soft-deleted jobs are left alone: a stale date on a
 * draft nobody published is not a live posting that expired.
 *
 * `EXPIRED_JOBS_GRACE_DAYS` (default 0) moves the cutoff back that many days,
 * turning this plus `archiveExpiredJobs` into archive-now / delete-later.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun] list and log what matches, write nothing
 * @param {number} [opts.graceDays] override EXPIRED_JOBS_GRACE_DAYS
 * @returns {Promise<{deleted:number,matched:number,clickEventsDeleted:number,dryRun:boolean,cutoff:Date,graceDays:number,jobs:Array<object>}>}
 */
async function deleteExpiredJobs(opts = {}) {
    const dryRun = opts.dryRun ?? isDryRun();
    const graceDays = opts.graceDays ?? getExpiryGraceDays();
    const now = new Date();
    const cutoff = graceDays > 0 ? new Date(now.getTime() - graceDays * DAY_MS) : now;

    const filter = {
        deletedAt: null,
        validThrough: { $ne: null, $lte: cutoff },
        $or: [{ status: "published" }, { archivedReason: AUTO_EXPIRED_REASON }],
    };

    // Read the documents before removing them: once deleteMany has run this
    // list is the only record of what was destroyed, so it goes to the logs and
    // to the Telegram cleanup report.
    const doomed = await JobV2.find(filter)
        .select("_id slug title companyName applyLink validThrough status")
        .lean();

    const jobs = doomed.map((j) => ({
        _id: j._id,
        slug: j.slug,
        title: j.title,
        companyName: j.companyName,
        applyLink: j.applyLink,
        reason: `validThrough ${new Date(j.validThrough).toISOString().slice(0, 10)}`,
    }));

    const base = { matched: jobs.length, dryRun, cutoff, graceDays, jobs };
    const where = `validThrough <= ${cutoff.toISOString()}, grace=${graceDays}d`;

    if (dryRun) {
        logger.info(`[expire] dry-run: would hard-delete ${jobs.length} expired job(s) (${where})`);
        return { ...base, deleted: 0, clickEventsDeleted: 0 };
    }

    if (jobs.length === 0) {
        logger.info(`[expire] no expired jobs to delete (${where})`);
        return { ...base, deleted: 0, clickEventsDeleted: 0 };
    }

    for (const j of jobs) {
        logger.info(`[expire] deleting ${j._id} ${j.slug} — ${j.reason}`);
    }

    const ids = doomed.map((j) => j._id);
    const del = await JobV2.deleteMany({ _id: { $in: ids } });
    const deleted = del.deletedCount || 0;

    // Click events are analytics-only; failing to clear them must not turn a
    // completed delete into a failed run. Mirrors runVerification.
    let clickEventsDeleted = 0;
    try {
        const clicks = await JobClickV2.deleteMany({ job: { $in: ids } });
        clickEventsDeleted = clicks.deletedCount || 0;
    } catch (clickErr) {
        logger.error(`[expire] failed to clear click events for deleted jobs: ${clickErr.message}`);
    }

    logger.info(
        `[expire] hard-deleted ${deleted} expired job(s), ${clickEventsDeleted} click event(s) (${where})`
    );

    return { ...base, deleted, clickEventsDeleted };
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
            const cronStartedAt = Date.now();

            // Daily maintenance. Three passes, in this order:
            //
            //   1. deleteExpiredJobs — pure date sweep, and IRREVERSIBLE. A job
            //      whose stated validThrough has passed (by more than
            //      EXPIRED_JOBS_GRACE_DAYS) is removed from Mongo along with
            //      its click events. Covers jobs still sitting at "published"
            //      and ones an earlier run archived as auto-expired.
            //   2. archiveExpiredJobs — the grace-window pass. Jobs that
            //      expired too recently for pass 1 are flipped to "archived"
            //      so they leave the published set while they wait it out.
            //      With the default grace of 0 pass 1 already took them and
            //      this matches nothing.
            //   3. runVerification — fetches each remaining published job's
            //      apply link, oldest-checked first, and hard-deletes the ones
            //      the verifier confirms dead.
            //
            // No pass throwing may skip the Telegram report: the deleted counts
            // are the only record of an irreversible operation.
            let expiredDeleted = 0;
            let expiredClickEvents = 0;
            let expiredJobs = [];
            let expiryArchived = 0;
            let summary = null;
            let failure = null;

            try {
                const expiry = await deleteExpiredJobs();
                expiredDeleted = expiry.deleted;
                expiredClickEvents = expiry.clickEventsDeleted;
                expiredJobs = expiry.jobs;
            } catch (err) {
                logger.error(`[expire] cron delete sweep failed: ${err.stack || err.message}`);
                failure = err;
            }

            try {
                const archived = await archiveExpiredJobs();
                expiryArchived = archived.archived;
            } catch (err) {
                logger.error(`[expire] cron archive sweep failed: ${err.stack || err.message}`);
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
                expiredDeleted,
                clickEventsDeleted: (summary?.clickEventsDeleted ?? 0) + expiredClickEvents,
                totalChecked: summary?.totalChecked ?? 0,
                durationMs: Date.now() - cronStartedAt,
                dryRun: summary?.dryRun ?? isDryRun(),
                deletedJobs: [...expiredJobs, ...(summary?.deletedJobs ?? [])],
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
    deleteExpiredJobs,
    _internals: {
        buildJobUpdate,
        hostnameOf,
        makeDomainThrottle,
        getExpiryGraceDays,
        PER_DOMAIN_GAP_MS,
        AUTO_EXPIRED_REASON,
    },
};
