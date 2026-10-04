/**
 * "Best to post" — the same three checks the admin jobs list highlights rows
 * with (admin-panel/src/Helpers/bestToPost.js). Keep the two in sync: the
 * digest is meant to send exactly the jobs the admin panel marks.
 *
 *   1. The company has a logo.
 *   2. The company is a known one — companyType in KNOWN_COMPANY_TYPES.
 *   3. It is a fresher role — the experience range sits inside 0–4 years.
 *
 * The admin panel resolves the company from a lazily hydrated map; here the
 * job arrives with `company` populated, which is the only difference.
 */

const KNOWN_COMPANY_TYPES = ["bigtech", "mnc", "unicorn", "product"];

const FRESHER_MAX_EXPERIENCE = 4;

const toNumber = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
};

const populatedCompany = (job) =>
    job?.company && typeof job.company === "object" ? job.company : null;

const hasCompanyLogo = (job) => {
    const company = populatedCompany(job);
    return !!(company?.logo?.icon || company?.logo?.banner);
};

const isKnownCompany = (job) =>
    KNOWN_COMPANY_TYPES.includes(populatedCompany(job)?.companyType);

/**
 * Fresher-friendly means the whole advertised range fits within 0–4 years.
 * A job with no experience data at all does not qualify — we cannot confirm it.
 */
const isFresherExperience = (experience) => {
    const min = toNumber(experience?.min);
    const max = toNumber(experience?.max);
    if (min === null && max === null) return false;
    if (min !== null && (min < 0 || min > FRESHER_MAX_EXPERIENCE)) return false;
    if (max !== null && max > FRESHER_MAX_EXPERIENCE) return false;
    return true;
};

const isBestToPost = (job) =>
    hasCompanyLogo(job) && isKnownCompany(job) && isFresherExperience(job?.experience);

module.exports = {
    KNOWN_COMPANY_TYPES,
    FRESHER_MAX_EXPERIENCE,
    hasCompanyLogo,
    isKnownCompany,
    isFresherExperience,
    isBestToPost,
};
