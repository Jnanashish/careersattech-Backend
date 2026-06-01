const { customAlphabet } = require("nanoid");
const CompanyV2 = require("../../modules/companiesV2/companiesV2.model");
const { generateCompanySlug } = require("../../utils/slugify");
const { normalizeCompanyName, keysMatch } = require("../../utils/companyNameMatch");

const nanoid = customAlphabet("23456789abcdefghjkmnpqrstuvwxyz", 4);

// Coarse Mongo prefilter for the heuristic scan: pull companies whose name
// starts with the same first letters (optionally behind a leading "the").
// Keeps the in-app fuzzy compare bounded instead of scanning the whole table.
const CANDIDATE_LIMIT = 200;
const CANDIDATE_PREFIX_LEN = 2;

function escapeRegex(str) {
    return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function findBySlugActive(slug) {
    return CompanyV2.findOne({ slug, deletedAt: null }).select("_id slug companyName").lean();
}

async function slugExistsAnywhere(slug) {
    const hit = await CompanyV2.findOne({ slug }).select("_id").lean();
    return !!hit;
}

async function findByExactName(companyName) {
    return CompanyV2.findOne({ companyName: companyName.trim(), deletedAt: null })
        .collation({ locale: "en", strength: 2 })
        .select("_id slug companyName")
        .lean();
}

/**
 * Heuristic scan: find an active company whose canonical name key matches the
 * given key. Handles "Adani Group"/"Adani"/"Ada" and "ABC Private Limited"/"ABC".
 */
async function findByHeuristic(key) {
    if (!key || key.length < 1) return null;
    const prefix = key.slice(0, CANDIDATE_PREFIX_LEN);
    const prefixRe = new RegExp(`^(the[^a-z0-9]+)?${escapeRegex(prefix)}`, "i");

    const candidates = await CompanyV2.find({
        deletedAt: null,
        companyName: { $regex: prefixRe },
    })
        .select("_id slug companyName")
        .limit(CANDIDATE_LIMIT)
        .lean();

    for (const c of candidates) {
        if (keysMatch(key, normalizeCompanyName(c.companyName))) return c;
    }
    return null;
}

/**
 * Locate an existing company for a raw name without creating anything.
 * Order: exact (case-insensitive) name → slug → heuristic key match.
 * Returns the lean company doc ({ _id, slug, companyName }) or null.
 */
async function findExistingCompany(companyName) {
    if (!companyName || typeof companyName !== "string" || !companyName.trim()) {
        return null;
    }
    const trimmed = companyName.trim();

    const byName = await findByExactName(trimmed);
    if (byName) return byName;

    const baseSlug = generateCompanySlug(trimmed);
    const bySlug = await findBySlugActive(baseSlug);
    if (bySlug) return bySlug;

    return findByHeuristic(normalizeCompanyName(trimmed));
}

async function uniqueStubSlug(base) {
    if (!(await slugExistsAnywhere(base))) return base;
    for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = `${base}-${nanoid()}`;
        if (!(await slugExistsAnywhere(candidate))) return candidate;
    }
    throw new Error(`Could not find unique slug for company stub "${base}"`);
}

/**
 * Resolve a company by name, reusing an existing one when a heuristic match is
 * found and only creating a stub as a last resort.
 */
async function resolveCompany(companyName) {
    if (!companyName || typeof companyName !== "string" || !companyName.trim()) {
        throw new Error("resolveCompany: companyName is required");
    }
    const trimmed = companyName.trim();

    const existing = await findExistingCompany(trimmed);
    if (existing) {
        return { _id: existing._id, slug: existing.slug, wasCreated: false };
    }

    const baseSlug = generateCompanySlug(trimmed);
    const finalSlug = await uniqueStubSlug(baseSlug);
    const stub = await CompanyV2.create({
        companyName: trimmed,
        slug: finalSlug,
        status: "active",
        isVerified: false,
    });
    return { _id: stub._id, slug: stub.slug, wasCreated: true };
}

module.exports = { resolveCompany, findExistingCompany };
