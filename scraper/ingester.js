const StagingJob = require("./models/StagingJob");
const Jobdesc = require("../model/jobs.schema");

function generateFingerprint(jobData) {
    const company = (jobData.companyName || "unknown").toLowerCase().trim();
    const title = (jobData.title || "").toLowerCase().trim();
    const location = (jobData.location || "").toLowerCase().split(",")[0].trim();
    return `${company}_${title}_${location}`.replace(/\s+/g, "-");
}

async function ingest(transformedJobs, adapterName, aiProvider) {
    let newCount = 0;
    let skippedCount = 0;
    const errors = [];

    for (const job of transformedJobs) {
        try {
            const fingerprint = generateFingerprint(job.jobData);
            const jobId = job.jobData.jobId || null;

            // Layer 1: Check by jobId (most reliable if available)
            if (jobId) {
                const existingByJobId = await StagingJob.findOne({ "jobData.jobId": jobId });
                if (existingByJobId) {
                    console.log(`[Ingester] Skipping (jobId ${jobId} already in staging): ${job.jobData.title}`);
                    skippedCount++;
                    continue;
                }
                const liveByJobId = await Jobdesc.findOne({ jobId });
                if (liveByJobId) {
                    console.log(`[Ingester] Skipping (jobId ${jobId} already live): ${job.jobData.title}`);
                    skippedCount++;
                    continue;
                }
            }

            // Layer 2: Check by fingerprint in staging (any status)
            const existingStaging = await StagingJob.findOne({ fingerprint });
            if (existingStaging) {
                console.log(`[Ingester] Skipping (fingerprint match in staging): ${job.jobData.title}`);
                skippedCount++;
                continue;
            }

            // Layer 3: Check by apply link URL in staging and main collection
            if (job.jobData.link) {
                const existingByLink = await StagingJob.findOne({ "jobData.link": job.jobData.link });
                if (existingByLink) {
                    console.log(`[Ingester] Skipping (same apply link in staging): ${job.jobData.title}`);
                    skippedCount++;
                    continue;
                }
                const liveByLink = await Jobdesc.findOne({ link: job.jobData.link });
                if (liveByLink) {
                    console.log(`[Ingester] Skipping (same apply link already live): ${job.jobData.title}`);
                    skippedCount++;
                    continue;
                }
            }

            // Layer 4: Check by company + title in main collection (fuzzy)
            const existingMain = await Jobdesc.findOne({
                companyName: { $regex: new RegExp(`^${escapeRegex(job.jobData.companyName || "")}$`, "i") },
                title: { $regex: new RegExp(`^${escapeRegex(job.jobData.title || "")}$`, "i") },
            });
            if (existingMain) {
                console.log(`[Ingester] Skipping (company+title match already live): ${job.jobData.title}`);
                skippedCount++;
                continue;
            }

            await StagingJob.create({
                status: "pending",
                source: adapterName,
                sourceUrl: job.sourceUrl,
                companyPageUrl: job.companyPageUrl,
                fingerprint,
                jobData: job.jobData,
                aiProvider,
            });

            console.log(`[Ingester] Staged: ${job.jobData.title} at ${job.jobData.companyName}`);
            newCount++;
        } catch (err) {
            if (err.code === 11000) {
                // Duplicate fingerprint — race condition, treat as skip
                skippedCount++;
            } else {
                console.error(`[Ingester] Error ingesting ${job.jobData.title}: ${err.message}`);
                errors.push({
                    jobUrl: job.sourceUrl,
                    step: "ingest",
                    message: err.message,
                });
            }
        }
    }

    console.log(`[Ingester] Done: ${newCount} new, ${skippedCount} skipped, ${errors.length} errors`);
    return { new: newCount, skipped: skippedCount, errors };
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = { ingest, generateFingerprint };
