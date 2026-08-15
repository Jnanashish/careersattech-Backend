const cron = require("node-cron");
const { randomUUID } = require("crypto");
const { scrapeAll, getAdapterByName } = require("../modules/scraper/scraper.fetch");
const { transformBatch } = require("../modules/scraper/transformer");
const { ingest, filterKnownJobs } = require("../modules/scraper/ingester");
const { autoPublishStaged, publishPendingBacklog } = require("../modules/scraper/publisher");
const { getProvider } = require("../modules/scraper/providers");
const ScrapeLog = require("../modules/scraper/models/scrapeLog.model");
const notifier = require("../modules/scraper/notifier");
const { isStopRequested, clearStop } = require("../modules/scraper/stopFlags");

// How many pending staging rows one run may sweep. Five adapter crons a day →
// up to 500 backlog rows cleared daily, without one run doing an unbounded scan.
const BACKLOG_DRAIN_LIMIT = 100;

async function runPipeline(trigger = "manual", adapterList = undefined, opts = {}) {
    const runId = randomUUID();
    const startedAt = new Date();
    const aiProvider = getProvider().name;

    // Auto-publish bypass: scraped jobs go live in JobV2 immediately instead of
    // waiting in the staging review queue. ON by default — no manual approval
    // step. Set SCRAPER_AUTO_PUBLISH=false to fall back to human review; a
    // per-run opts.autoPublish wins over both.
    //
    // The staging queue is bypassed, not removed: every job is still written to
    // StagingJob first (that's where dedupe fingerprints live), and any job that
    // fails the publish-readiness gate stays `pending` there for manual review.
    const autoPublish = typeof opts.autoPublish === "boolean"
        ? opts.autoPublish
        : process.env.SCRAPER_AUTO_PUBLISH !== "false";

    console.log(
        `[Scheduler] Starting scrape run ${runId} ` +
        `(trigger: ${trigger}, ai: ${aiProvider}, autoPublish: ${autoPublish})`
    );

    const adapterResults = [];
    let totalNew = 0;
    let totalSkipped = 0;
    let totalPublished = 0;
    let totalBacklogPublished = 0;
    let totalErrors = 0;
    const adaptersSucceeded = [];
    const adaptersFailed = [];

    // Drain the pending backlog first: rows staged by an earlier run (before
    // the bypass existed, or while it was off) are invisible to the per-adapter
    // auto-publish below, which only sees what this run created — and dedupe
    // means a re-scrape skips those jobs rather than re-staging them, so
    // without this they stay pending forever.
    //
    // Runs before the adapters (not after) so it never immediately re-tries a
    // row this same run just failed the readiness gate on. Never throws: a
    // broken drain must not take the scrape down with it.
    if (autoPublish) {
        try {
            const backlog = await publishPendingBacklog({
                limit: BACKLOG_DRAIN_LIMIT,
                approvedBy: "auto-scraper:backlog",
            });
            totalBacklogPublished = backlog.published;
            totalPublished += backlog.published;
            if (backlog.scanned > 0) {
                console.log(
                    `[Scheduler] Backlog drain: published ${backlog.published}/${backlog.scanned} ` +
                    `pending staging rows (${backlog.failed} still pending)`
                );
            }
        } catch (err) {
            console.error(`[Scheduler] Backlog drain failed: ${err.message}`);
        }
    }

    try {
        const scrapeResults = await scrapeAll(adapterList);

        for (const result of scrapeResults) {
            // Check if stop was requested for this adapter
            if (isStopRequested(result.adapter) || result.stats.stopped || result.stats.status === "stopped") {
                console.log(`[Scheduler] ${result.adapter}: stop requested, skipping transform/ingest`);
                adapterResults.push({
                    name: result.adapter,
                    jobLinksFound: result.stats.jobLinksFound || 0,
                    jobsFetched: result.stats.jobsFetched || 0,
                    jobsTransformed: 0,
                    jobsIngested: 0,
                    jobsSkipped: 0,
                    errors: [],
                    durationMs: result.stats.durationMs || 0,
                    status: "stopped",
                });
                continue;
            }

            const adapterStart = Date.now();
            const adapterLog = {
                name: result.adapter,
                jobLinksFound: result.stats.jobLinksFound,
                jobsFetched: result.stats.jobsFetched,
                jobsTransformed: 0,
                jobsIngested: 0,
                jobsPublished: 0,
                jobsSkipped: 0,
                errors: [...result.stats.errors],
                durationMs: result.stats.durationMs,
            };

            if (result.stats.status === "failed") {
                adapterLog.status = "failed";
                adaptersFailed.push(result.adapter);
                totalErrors += result.stats.errors.length;
                adapterResults.push(adapterLog);

                await notifier.sendAdapterAlert(
                    result.adapter,
                    result.stats.errors[0]?.jobUrl || "unknown",
                    result.stats.errors[0]?.message || "Unknown error"
                );
                continue;
            }

            // Pre-filter: skip jobs already in staging or live (saves LLM calls)
            const { filtered: newJobs, skipped: preSkipped } = await filterKnownJobs(result.jobs);
            adapterLog.jobsSkipped += preSkipped;
            totalSkipped += preSkipped;

            if (newJobs.length === 0) {
                console.log(`[Scheduler] ${result.adapter}: all jobs already known, skipping transform`);
                adapterLog.status = "success";
                adaptersSucceeded.push(result.adapter);
                adapterResults.push(adapterLog);
                continue;
            }

            // Transform
            const { results: transformed, errors: transformErrors } = await transformBatch(newJobs);
            adapterLog.jobsTransformed = transformed.length;
            adapterLog.errors.push(...transformErrors);

            // Ingest
            if (transformed.length > 0) {
                const ingestResult = await ingest(transformed, result.adapter, aiProvider);
                adapterLog.jobsIngested = ingestResult.new;
                adapterLog.jobsSkipped = ingestResult.skipped;
                adapterLog.errors.push(...ingestResult.errors);

                totalNew += ingestResult.new;
                totalSkipped += ingestResult.skipped;

                // Auto-publish bypass: push freshly-staged jobs straight to
                // JobV2 instead of waiting for manual approval. Jobs that fail
                // the publish-readiness gate stay `pending` in staging, so
                // they still surface in the manual review queue.
                if (autoPublish && ingestResult.created.length > 0) {
                    const pub = await autoPublishStaged(ingestResult.created, {
                        approvedBy: `auto-scraper:${result.adapter}`,
                    });
                    adapterLog.jobsPublished = pub.published;
                    totalPublished += pub.published;
                    console.log(
                        `[Scheduler] ${result.adapter}: auto-published ` +
                        `${pub.published}/${ingestResult.created.length} ` +
                        `(${pub.failed} left in staging)`
                    );
                }
            }

            totalErrors += adapterLog.errors.length;
            adapterLog.durationMs = Date.now() - adapterStart + result.stats.durationMs;

            if (adapterLog.errors.length === 0) {
                adapterLog.status = "success";
                adaptersSucceeded.push(result.adapter);
            } else if (adapterLog.jobsIngested > 0 || adapterLog.jobsTransformed > 0) {
                adapterLog.status = "partial";
                adaptersSucceeded.push(result.adapter);
            } else {
                adapterLog.status = "failed";
                adaptersFailed.push(result.adapter);
            }

            adapterResults.push(adapterLog);
        }
    } catch (err) {
        console.error(`[Scheduler] Critical pipeline error: ${err.message}`);
        await notifier.sendCriticalAlert(err.message);
    }

    // Save scrape log
    const scrapeLog = await ScrapeLog.create({
        runId,
        startedAt,
        completedAt: new Date(),
        trigger,
        aiProvider,
        adapters: adapterResults,
        summary: {
            totalNew,
            totalPublished,
            totalBacklogPublished,
            totalSkipped,
            totalErrors,
            adaptersSucceeded,
            adaptersFailed,
        },
    });

    // Clear stop flags for adapters that were stopped in this run
    for (const result of adapterResults) {
        if (result.status === "stopped") {
            clearStop(result.name);
        }
    }

    console.log(
        `[Scheduler] Run ${runId} complete: ${totalNew} new, ` +
        `${totalPublished} published (${totalBacklogPublished} from backlog), ` +
        `${totalSkipped} skipped, ${totalErrors} errors`
    );

    // Check consecutive failures
    await checkConsecutiveFailures(adaptersFailed);

    // Send report
    await notifier.sendScrapeReport(scrapeLog);

    return scrapeLog;
}

async function checkConsecutiveFailures(failedAdapters) {
    for (const adapterName of failedAdapters) {
        try {
            const recentLogs = await ScrapeLog.find({})
                .sort({ startedAt: -1 })
                .limit(5)
                .lean();

            let consecutive = 0;
            for (const log of recentLogs) {
                const adapterEntry = log.adapters?.find((a) => a.name === adapterName);
                if (adapterEntry && adapterEntry.status === "failed") {
                    consecutive++;
                } else {
                    break;
                }
            }

            if (consecutive >= 5) {
                console.warn(
                    `[Scheduler] WARNING: ${adapterName} has failed ${consecutive} consecutive runs`
                );
                await notifier.sendRepeatedFailureAlert(adapterName, consecutive);
            }
        } catch (err) {
            console.error(`[Scheduler] Error checking failures for ${adapterName}: ${err.message}`);
        }
    }
}

// Each source runs on its own daily cron, staggered 2 hours apart, so the
// scraper-API keys and the AI provider never get hit by all five sources at
// once. Times are IST (pinned via SCRAPER_TZ below). Anchored on the original
// 6 PM IST slot (onlyfrontendjobs). Each cron runs the full pipeline for a
// single adapter via runPipeline(trigger, [adapter]).
const SCRAPER_TZ = process.env.SCRAPER_TZ || "Asia/Kolkata";

const ADAPTER_SCHEDULES = [
    { name: "freshershunt", cron: "0 12 * * *" },     // 12:00 IST
    { name: "freshersjobs", cron: "0 14 * * *" },     // 14:00 IST
    { name: "offcampusjobs4u", cron: "0 16 * * *" },  // 16:00 IST
    { name: "onlyfrontendjobs", cron: "0 18 * * *" }, // 18:00 IST (6 PM)
    { name: "peerlist", cron: "0 20 * * *" },         // 20:00 IST
];

function init() {
    console.log(
        `[Scheduler] Staggering ${ADAPTER_SCHEDULES.length} adapters 2h apart (tz=${SCRAPER_TZ})`
    );

    for (const { name, cron: schedule } of ADAPTER_SCHEDULES) {
        const adapter = getAdapterByName(name);
        if (!adapter) {
            console.warn(`[Scheduler] adapter "${name}" not found, skipping its schedule`);
            continue;
        }

        console.log(`[Scheduler] ${name}: "${schedule}" (${SCRAPER_TZ})`);

        cron.schedule(
            schedule,
            async () => {
                try {
                    await runPipeline("cron", [adapter]);
                } catch (err) {
                    console.error(`[Scheduler] Cron run failed for ${name}: ${err.message}`);
                    await notifier.sendCriticalAlert(`Cron run failed for ${name}: ${err.message}`);
                }
            },
            { timezone: SCRAPER_TZ }
        );
    }

    console.log("[Scheduler] Cron scheduled successfully");
}

module.exports = { init, runPipeline, ADAPTER_SCHEDULES };
