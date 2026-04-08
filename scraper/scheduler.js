const cron = require("node-cron");
const { randomUUID } = require("crypto");
const { scrapeAll } = require("./scraper");
const { transformBatch } = require("./transformer");
const { ingest, filterKnownJobs } = require("./ingester");
const { getProvider } = require("./providers");
const ScrapeLog = require("./models/ScrapeLog");
const notifier = require("./notifier");
const { isStopRequested, clearStop } = require("./stopFlags");

async function runPipeline(trigger = "manual") {
    const runId = randomUUID();
    const startedAt = new Date();
    const aiProvider = getProvider().name;

    console.log(`[Scheduler] Starting scrape run ${runId} (trigger: ${trigger}, ai: ${aiProvider})`);

    const adapterResults = [];
    let totalNew = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    const adaptersSucceeded = [];
    const adaptersFailed = [];

    try {
        const scrapeResults = await scrapeAll();

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
        `[Scheduler] Run ${runId} complete: ${totalNew} new, ${totalSkipped} skipped, ${totalErrors} errors`
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

// 6:00 PM IST = 12:30 UTC
const CRON_SCHEDULE = "30 12 * * *";

function init() {
    console.log(`[Scheduler] Initializing cron: ${CRON_SCHEDULE} (6PM IST daily)`);

    cron.schedule(CRON_SCHEDULE, async () => {
        try {
            await runPipeline("cron");
        } catch (err) {
            console.error(`[Scheduler] Cron run failed: ${err.message}`);
            await notifier.sendCriticalAlert(`Cron run failed: ${err.message}`);
        }
    });

    console.log("[Scheduler] Cron scheduled successfully");
}

module.exports = { init, runPipeline };
