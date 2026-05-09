const slugify = require("slugify");
const { customAlphabet } = require("nanoid");

const NANOID_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const NANOID_LENGTH = 6;
const BASE_MAX_LENGTH = 70;
const SLUG_MAX_LENGTH = 100;
const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUGIFY_OPTS = { lower: true, strict: true, trim: true };

const nanoid = customAlphabet(NANOID_ALPHABET, NANOID_LENGTH);

function toSlug(input) {
    return slugify(String(input), SLUGIFY_OPTS);
}

function generateJobSlug(companyName, title) {
    if (!companyName || typeof companyName !== "string" || !companyName.trim()) {
        throw new Error("generateJobSlug: companyName is required and must be a non-empty string");
    }
    if (!title || typeof title !== "string" || !title.trim()) {
        throw new Error("generateJobSlug: title is required and must be a non-empty string");
    }

    const companySlug = toSlug(companyName);
    const titleSlug = toSlug(title);

    if (!companySlug) {
        throw new Error("generateJobSlug: companyName produced an empty slug after normalization");
    }
    if (!titleSlug) {
        throw new Error("generateJobSlug: title produced an empty slug after normalization");
    }

    let base = `${companySlug}-${titleSlug}`;
    if (base.length > BASE_MAX_LENGTH) {
        base = base.slice(0, BASE_MAX_LENGTH).replace(/-+$/, "");
    }

    return `${base}-${nanoid()}`;
}

function generateCompanySlug(companyName) {
    if (!companyName || typeof companyName !== "string" || !companyName.trim()) {
        throw new Error("generateCompanySlug: companyName is required and must be a non-empty string");
    }

    const slug = toSlug(companyName);
    if (!slug) {
        throw new Error("generateCompanySlug: companyName produced an empty slug after normalization");
    }
    return slug;
}

function validateSlug(slug) {
    if (slug === null || slug === undefined || typeof slug !== "string" || slug.length === 0) {
        return { valid: false, error: "Slug is required" };
    }
    if (slug.length > SLUG_MAX_LENGTH) {
        return { valid: false, error: "Slug cannot exceed 100 characters" };
    }
    if (!SLUG_REGEX.test(slug)) {
        return {
            valid: false,
            error: "Slug must contain only lowercase letters, numbers, and hyphens (no leading/trailing/consecutive hyphens)",
        };
    }
    return { valid: true, error: null };
}

module.exports = {
    generateJobSlug,
    generateCompanySlug,
    validateSlug,
};
