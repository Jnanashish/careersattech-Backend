const cron = require("node-cron");
const logger = require("../utils/logger");
const JobV2 = require("../modules/jobsV2/jobsV2.model");
const { verifyJob } = require("../services/jobVerifier");
const emailReporter = require("../services/jobVerifier/emailReporter");
const { buildArchiveFields, AUTO_EXPIRY_REASON } = require("../modules/jobsV2/jobsV2.lifecycle");

const DEFAULT_CRON = "0 3 */3 * *"; // every 3 days at 3 AM
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
        // Same archive shape as the admin endpoint (single source of truth);
        // merged into the bulkWrite $set instead of a per-doc archiveJob() call.
        Object.assign(set, buildArchiveFields(AUTO_EXPIRY_REASON, now));
        set["verification.consecutiveInconclusive"] = 0;
    } else if (result.result === "active") {
        set["verification.consecutiveInconclusive"] = 0;
    } else if (result.result === "inconclusive") {
        update.$inc = { "verification.consecutiveInconclusive": 1 };
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
 * @param {string} [opts.trigger]  "cron" | "manual"
 * @returns {Promise<object>} summary
 */
async function runVerification(opts = {}) {
    const startedAt = new Date();
    const dryRun = opts.dryRun ?? isDryRun();
    const skipEmail = !!opts.skipEmail;
    const trigger = opts.trigger || "manual";

    logger.info(
        `[verify] start trigger=${trigger} dryRun=${dryRun} limit=${opts.limit || "all"} jobId=${
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
    const inconclusiveJobs = [];
    const bulkOps = [];
    let activeCount = 0;
    let expiredCount = 0;
    let inconclusiveCount = 0;

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
                bulkOps.push(buildJobUpdate(job, result, now));

                if (result.result === "expired") {
                    expiredCount++;
                    archivedJobs.push({
                        _id: job._id,
                        slug: job.slug,
                        title: job.title,
                        companyName: job.companyName,
                        applyLink: job.applyLink,
                        reason: result.reason,
                    });
                } else if (result.result === "inconclusive") {
                    inconclusiveCount++;
                    const prevConsec = job.verification?.consecutiveInconclusive || 0;
                    inconclusiveJobs.push({
                        _id: job._id,
                        slug: job.slug,
                        title: job.title,
                        companyName: job.companyName,
                        applyLink: job.applyLink,
                        reason: result.reason,
                        consecutiveInconclusive: prevConsec + 1,
                    });
                } else {
                    activeCount++;
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

    const completedAt = new Date();
    const durationMs = completedAt - startedAt;

    const summary = {
        trigger,
        dryRun,
        startedAt,
        completedAt,
        durationMs,
        totalChecked: jobs.length,
        activeCount,
        expiredCount,
        inconclusiveCount,
        archivedJobs,
        inconclusiveJobs,
    };

    logger.info(
        `[verify] Run complete. checked=${summary.totalChecked} active=${activeCount} archived=${expiredCount} inconclusive=${inconclusiveCount} duration=${durationMs}ms`
    );

    if (!skipEmail) {
        await emailReporter.sendSummary(summary, { dryRun });
    }

    return summary;
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
            try {
                await runVerification({ trigger: "cron" });
            } catch (err) {
                logger.error(`[verify] cron run failed: ${err.stack || err.message}`);
            }
        },
        { timezone }
    );
}

module.exports = {
    init,
    runVerification,
    _internals: {
        buildJobUpdate,
        hostnameOf,
        makeDomainThrottle,
        PER_DOMAIN_GAP_MS,
    },
};
