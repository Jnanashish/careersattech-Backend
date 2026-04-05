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

async function filterKnownUrls(urls) {
    if (!urls.length) return new Set();

    const [stagingBySource, liveByLink] = await Promise.all([
        StagingJob.find({ sourceUrl: { $in: urls } }, { sourceUrl: 1 }).lean(),
        Jobdesc.find({ link: { $in: urls } }, { link: 1 }).lean(),
    ]);

    const known = new Set();
    stagingBySource.forEach((j) => known.add(j.sourceUrl));
    liveByLink.forEach((j) => known.add(j.link));
    return known;
}

async function filterKnownJobs(jobs) {
    if (!jobs.length) return { filtered: jobs, skipped: 0 };

    const sourceUrls = jobs.map((j) => j.sourceUrl).filter(Boolean);
    const companyUrls = jobs.map((j) => j.companyPageUrl).filter(Boolean);
    const allUrls = [...new Set([...sourceUrls, ...companyUrls])];

    const [knownUrls, stagingByLink] = await Promise.all([
        filterKnownUrls(allUrls),
        companyUrls.length
            ? StagingJob.find({ "jobData.link": { $in: companyUrls } }, { "jobData.link": 1 }).lean()
            : [],
    ]);

    stagingByLink.forEach((j) => {
        if (j.jobData?.link) knownUrls.add(j.jobData.link);
    });

    const filtered = jobs.filter((j) => {
        if (knownUrls.has(j.sourceUrl)) return false;
        if (j.companyPageUrl && knownUrls.has(j.companyPageUrl)) return false;
        return true;
    });

    const skipped = jobs.length - filtered.length;
    if (skipped > 0) {
        console.log(`[Dedup] Pre-filter: skipped ${skipped} already-known jobs out of ${jobs.length}`);
    }
    return { filtered, skipped };
}

module.exports = { ingest, generateFingerprint, filterKnownUrls, filterKnownJobs };
