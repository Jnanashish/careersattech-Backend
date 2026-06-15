const JobV2 = require("./jobsV2.model");
const {
    generateJobSlug,
    dateSlugSuffix,
    randomSlugSuffix,
} = require("../../utils/slugify");

const MAX_RANDOM_ATTEMPTS = 5;

/**
 * True if any JobV2 (including soft-deleted) already owns this slug. The check
 * intentionally spans soft-deleted docs because the `slug` unique index does
 * too — excluding them would let an insert slip past here and then fail at the
 * DB with a duplicate-key error.
 */
async function slugTaken(slug) {
    return Boolean(await JobV2.findOne({ slug }).select("_id").lean());
}

/**
 * Resolve a unique JobV2 slug for the given company + title.
 *
 * Ladder (clean → disambiguated):
 *   1. "company-title"                       — clean, deterministic
 *   2. "company-title-YYYY-MM-DD"            — first collision (date tie-breaker)
 *   3. "company-title-YYYY-MM-DD-<random>"   — last resort if the dated slug is taken too
 *
 * The clean base is deterministic, so reposting the same role reuses the same
 * URL once the prior posting is gone. The dated suffix only appears on a genuine
 * collision: a *different* job sharing company+title while the old one still
 * exists (active reposts are already deduped upstream by applyLink).
 */
async function resolveUniqueJobSlug(companyName, title) {
    const base = generateJobSlug(companyName, title);
    if (!(await slugTaken(base))) return base;

    const dated = `${base}-${dateSlugSuffix()}`;
    if (!(await slugTaken(dated))) return dated;

    for (let i = 0; i < MAX_RANDOM_ATTEMPTS; i += 1) {
        const candidate = `${dated}-${randomSlugSuffix()}`;
        if (!(await slugTaken(candidate))) return candidate;
    }

    throw new Error(
        `resolveUniqueJobSlug: could not generate a unique slug for "${companyName}" / "${title}"`
    );
}

module.exports = { resolveUniqueJobSlug, slugTaken };
