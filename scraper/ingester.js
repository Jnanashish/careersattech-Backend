const StagingJob = require("./models/StagingJob");
const JobV2 = require("../model/jobV2.schema");
const CompanyV2 = require("../model/companyV2.schema");

function escapeRegex(str) {
    return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function generateFingerprint(jobData) {
    const company = (jobData?.companyName || "unknown").toLowerCase().trim();
    const title = (jobData?.title || "").toLowerCase().trim();
    const firstCity = Array.isArray(jobData?.jobLocation) && jobData.jobLocation.length
        ? (jobData.jobLocation[0]?.city || "").toLowerCase().trim()
        : "";
    return `${company}_${title}_${firstCity}`.replace(/\s+/g, "-");
}

async function findCompanyByName(companyName) {
    if (!companyName || typeof companyName !== "string") return null;
    return CompanyV2.findOne({ companyName: companyName.trim(), deletedAt: null })
        .collation({ locale: "en", strength: 2 })
        .select("_id companyName")
        .lean();
}

async function ingest(transformedJobs, adapterName, aiProvider) {
    let newCount = 0;
    let skippedCount = 0;
    const errors = [];

    for (const job of transformedJobs) {
        const jobData = job.jobData || {};
        const companyData = job.companyData || {};

        try {
            // Ensure jobData carries the canonical companyName from the company block
            if (!jobData.companyName && companyData.companyName) {
                jobData.companyName = companyData.companyName;
            }

            const fingerprint = generateFingerprint(jobData);
            const externalJobId = jobData.externalJobId || null;

            // Layer 1: externalJobId match
            if (externalJobId) {
                const existingByExt = await StagingJob.findOne({ "jobData.externalJobId": externalJobId });
                if (existingByExt) {
                    console.log(`[Ingester] Skipping (externalJobId ${externalJobId} already in staging): ${jobData.title}`);
                    skippedCount++;
                    continue;
                }
                const liveByExt = await JobV2.findOne({ externalJobId, deletedAt: null });
                if (liveByExt) {
                    console.log(`[Ingester] Skipping (externalJobId ${externalJobId} already live): ${jobData.title}`);
                    skippedCount++;
                    continue;
                }
            }

            // Layer 2: fingerprint in staging
            const existingStaging = await StagingJob.findOne({ fingerprint });
            if (existingStaging) {
                console.log(`[Ingester] Skipping (fingerprint match in staging): ${jobData.title}`);
                skippedCount++;
                continue;
            }

            // Layer 3: applyLink match
            if (jobData.applyLink) {
                const existingByLink = await StagingJob.findOne({ "jobData.applyLink": jobData.applyLink });
                if (existingByLink) {
                    console.log(`[Ingester] Skipping (same apply link in staging): ${jobData.title}`);
                    skippedCount++;
                    continue;
                }
                const liveByLink = await JobV2.findOne({ applyLink: jobData.applyLink, deletedAt: null });
                if (liveByLink) {
                    console.log(`[Ingester] Skipping (same apply link already live): ${jobData.title}`);
                    skippedCount++;
                    continue;
                }
            }

            // Layer 4: company + title match in JobV2 (case-insensitive exact)
            if (jobData.companyName && jobData.title) {
                const existingMain = await JobV2.findOne({
                    companyName: { $regex: new RegExp(`^${escapeRegex(jobData.companyName)}$`, "i") },
                    title: { $regex: new RegExp(`^${escapeRegex(jobData.title)}$`, "i") },
                    deletedAt: null,
                });
                if (existingMain) {
                    console.log(`[Ingester] Skipping (company+title match already live): ${jobData.title}`);
                    skippedCount++;
                    continue;
                }
            }

            // Map to existing CompanyV2 if one already exists
            let matchedCompanyId = null;
            const existingCompany = await findCompanyByName(jobData.companyName);
            if (existingCompany) {
                matchedCompanyId = existingCompany._id;
                jobData.company = existingCompany._id;
                jobData.companyName = existingCompany.companyName; // canonical casing
            }

            await StagingJob.create({
                status: "pending",
                source: adapterName,
                sourceUrl: job.sourceUrl,
                companyPageUrl: job.companyPageUrl,
                fingerprint,
                jobData,
                companyData,
                matchedCompany: matchedCompanyId,
                aiProvider,
            });

            console.log(
                `[Ingester] Staged: ${jobData.title} @ ${jobData.companyName}` +
                (matchedCompanyId ? ` (linked to existing CompanyV2 ${matchedCompanyId})` : " (new company)")
            );
            newCount++;
        } catch (err) {
            if (err.code === 11000) {
                // Duplicate fingerprint — race condition, treat as skip
                skippedCount++;
            } else {
                console.error(`[Ingester] Error ingesting ${jobData.title}: ${err.message}`);
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

async function filterKnownUrls(urls) {
    if (!urls.length) return new Set();

    const [stagingBySource, liveByLink] = await Promise.all([
        StagingJob.find({ sourceUrl: { $in: urls } }, { sourceUrl: 1 }).lean(),
        JobV2.find({ applyLink: { $in: urls }, deletedAt: null }, { applyLink: 1 }).lean(),
    ]);

    const known = new Set();
    stagingBySource.forEach((j) => known.add(j.sourceUrl));
    liveByLink.forEach((j) => known.add(j.applyLink));
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
            ? StagingJob.find({ "jobData.applyLink": { $in: companyUrls } }, { "jobData.applyLink": 1 }).lean()
            : [],
    ]);

    stagingByLink.forEach((j) => {
        if (j.jobData?.applyLink) knownUrls.add(j.jobData.applyLink);
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

module.exports = { ingest, generateFingerprint, filterKnownUrls, filterKnownJobs, findCompanyByName };
