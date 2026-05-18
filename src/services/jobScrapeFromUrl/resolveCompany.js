const { customAlphabet } = require("nanoid");
const CompanyV2 = require("../../modules/companiesV2/companiesV2.model");
const { generateCompanySlug } = require("../../utils/slugify");

const nanoid = customAlphabet("23456789abcdefghjkmnpqrstuvwxyz", 4);

async function findBySlugActive(slug) {
    return CompanyV2.findOne({ slug, deletedAt: null }).select("_id slug companyName").lean();
}

async function slugExistsAnywhere(slug) {
    const hit = await CompanyV2.findOne({ slug }).select("_id").lean();
    return !!hit;
}

async function findByName(companyName) {
    return CompanyV2.findOne({ companyName: companyName.trim(), deletedAt: null })
        .collation({ locale: "en", strength: 2 })
        .select("_id slug companyName")
        .lean();
}

async function uniqueStubSlug(base) {
    if (!(await slugExistsAnywhere(base))) return base;
    for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = `${base}-${nanoid()}`;
        if (!(await slugExistsAnywhere(candidate))) return candidate;
    }
    throw new Error(`Could not find unique slug for company stub "${base}"`);
}

async function resolveCompany(companyName) {
    if (!companyName || typeof companyName !== "string" || !companyName.trim()) {
        throw new Error("resolveCompany: companyName is required");
    }
    const trimmed = companyName.trim();

    const byName = await findByName(trimmed);
    if (byName) {
        return { _id: byName._id, slug: byName.slug, wasCreated: false };
    }

    const baseSlug = generateCompanySlug(trimmed);
    const bySlug = await findBySlugActive(baseSlug);
    if (bySlug) {
        return { _id: bySlug._id, slug: bySlug.slug, wasCreated: false };
    }

    const finalSlug = await uniqueStubSlug(baseSlug);
    const stub = await CompanyV2.create({
        companyName: trimmed,
        slug: finalSlug,
        status: "active",
        isVerified: false,
    });
    return { _id: stub._id, slug: stub.slug, wasCreated: true };
}

module.exports = { resolveCompany };
