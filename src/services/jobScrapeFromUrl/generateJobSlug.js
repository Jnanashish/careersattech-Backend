const JobV2 = require("../../modules/jobsV2/jobsV2.model");
const { generateJobSlug: baseGenerateJobSlug } = require("../../utils/slugify");

async function generateUniqueJobSlug(companyNameOrSlug, jobTitle) {
    const first = baseGenerateJobSlug(companyNameOrSlug, jobTitle);
    const collision = await JobV2.findOne({ slug: first }).select("_id").lean();
    if (!collision) return first;

    const retry = baseGenerateJobSlug(companyNameOrSlug, jobTitle);
    const collision2 = await JobV2.findOne({ slug: retry }).select("_id").lean();
    if (!collision2) return retry;

    throw new Error(`Could not generate unique job slug for "${jobTitle}" after retry`);
}

module.exports = { generateUniqueJobSlug };
