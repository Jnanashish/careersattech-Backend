const { resolveUniqueJobSlug } = require("../../modules/jobsV2/resolveJobSlug");

/**
 * Thin wrapper kept for the scrape-from-URL flow. Slug resolution (clean base →
 * dated suffix → random tie-breaker) lives in the shared resolver so every job
 * creation path produces consistent slugs.
 */
async function generateUniqueJobSlug(companyNameOrSlug, jobTitle) {
    return resolveUniqueJobSlug(companyNameOrSlug, jobTitle);
}

module.exports = { generateUniqueJobSlug };
