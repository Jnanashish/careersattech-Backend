const JobV2 = require("../../modules/jobsV2/jobsV2.model");
const { fetchHtml } = require("./fetchHtml");
const { cleanHtml } = require("./cleanHtml");
const { extractJobFields } = require("./extractJobFields");
const { resolveCompany } = require("./resolveCompany");
const { generateUniqueJobSlug } = require("./generateJobSlug");

const VALID_EMPLOYMENT_TYPES = new Set([
    "FULL_TIME", "PART_TIME", "CONTRACTOR", "INTERN", "TEMPORARY",
]);
const VALID_WORK_MODES = new Set(["onsite", "hybrid", "remote"]);

function detectApplyPlatform(applyLink) {
    if (!applyLink) return "careerspage";
    if (applyLink.startsWith("mailto:")) return "email";
    try {
        const host = new URL(applyLink).hostname.toLowerCase();
        if (host.includes("linkedin.com")) return "linkedin";
        if (host.includes("cuvette.tech")) return "cuvette";
        return "careerspage";
    } catch {
        return "careerspage";
    }
}

function normalizeEmploymentType(value) {
    if (!Array.isArray(value)) return ["FULL_TIME"];
    const out = value
        .map((v) => (typeof v === "string" ? v.toUpperCase().trim() : ""))
        .filter((v) => VALID_EMPLOYMENT_TYPES.has(v));
    return out.length ? Array.from(new Set(out)) : ["FULL_TIME"];
}

function normalizeBatch(value) {
    const currentYear = new Date().getFullYear();
    const defaultBatch = [currentYear, currentYear - 1, currentYear - 2]
        .filter((y) => y >= 2020 && y <= 2030);
    if (!Array.isArray(value)) return defaultBatch;
    const parsed = Array.from(new Set(
        value
            .map((y) => parseInt(y, 10))
            .filter((y) => Number.isInteger(y) && y >= 2020 && y <= 2030)
    ));
    return parsed.length ? parsed : defaultBatch;
}

function normalizeJobLocation(value) {
    if (!Array.isArray(value)) return [];
    return value
        .map((loc) => {
            if (!loc || typeof loc !== "object") return null;
            const city = typeof loc.city === "string" ? loc.city.trim() : "";
            if (!city) return null;
            return {
                city,
                region: typeof loc.region === "string" ? loc.region.trim() : "",
                country: typeof loc.country === "string" && loc.country.trim()
                    ? loc.country.trim()
                    : "IN",
            };
        })
        .filter(Boolean);
}

function normalizeBaseSalary(value) {
    if (!value || typeof value !== "object") return undefined;
    const min = Number(value.min);
    const max = Number(value.max);
    const hasMin = Number.isFinite(min);
    const hasMax = Number.isFinite(max);
    if (!hasMin && !hasMax) return undefined;
    return {
        currency: typeof value.currency === "string" && value.currency.trim()
            ? value.currency.trim().toUpperCase()
            : "INR",
        min: hasMin ? min : undefined,
        max: hasMax ? max : undefined,
        unitText: ["HOUR", "DAY", "WEEK", "MONTH", "YEAR"].includes(value.unitText)
            ? value.unitText
            : "YEAR",
    };
}

function normalizeDate(value) {
    if (!value || typeof value !== "string") return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
}

function normalizeStringArray(value, { lower = false } = {}) {
    if (!Array.isArray(value)) return [];
    return value
        .map((v) => (typeof v === "string" ? (lower ? v.trim().toLowerCase() : v.trim()) : ""))
        .filter(Boolean);
}

function buildJobDoc({ fields, applyLink, slug, company, postedBy }) {
    const employmentType = normalizeEmploymentType(fields.employmentType);
    const batch = normalizeBatch(fields.batch);
    const jobLocation = normalizeJobLocation(fields.jobLocation);
    const baseSalary = normalizeBaseSalary(fields.baseSalary);

    const jdHtml = fields.jobDescription?.html
        || fields.jobDescription?.plain
        || "";
    const jdPlain = fields.jobDescription?.plain
        || (jdHtml ? jdHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : "");

    const workMode = VALID_WORK_MODES.has(fields.workMode) ? fields.workMode : null;

    const doc = {
        title: typeof fields.title === "string" ? fields.title.trim() : "",
        slug,
        company: company._id,
        companyName: typeof fields.companyName === "string" ? fields.companyName.trim() : "",
        displayMode: "external_redirect",
        applyLink,
        employmentType,
        batch,
        jobDescription: jdHtml ? { html: jdHtml, plain: jdPlain } : undefined,
        workMode,
        category: typeof fields.category === "string" ? fields.category : null,
        degree: normalizeStringArray(fields.degree),
        experience: fields.experience && typeof fields.experience === "object"
            ? {
                min: Number.isInteger(fields.experience.min) ? fields.experience.min : 0,
                max: Number.isInteger(fields.experience.max) ? fields.experience.max : 2,
            }
            : undefined,
        jobLocation,
        baseSalary,
        requiredSkills: normalizeStringArray(fields.requiredSkills, { lower: true }),
        preferredSkills: normalizeStringArray(fields.preferredSkills, { lower: true }),
        topicTags: normalizeStringArray(fields.topicTags, { lower: true }),
        applyPlatform: detectApplyPlatform(applyLink),
        datePosted: normalizeDate(fields.datePosted) || new Date(),
        validThrough: normalizeDate(fields.validThrough) || undefined,
        status: "published",
        source: "scraped",
        externalJobId: applyLink,
        publishedAt: new Date(),
    };
    if (postedBy) doc.postedBy = postedBy;
    return doc;
}

async function scrapeAndCreateJob({ applyLink, postedBy } = {}) {
    if (!applyLink || typeof applyLink !== "string") {
        throw new Error("scrapeAndCreateJob: applyLink is required");
    }

    // 1. Duplicate check
    const existing = await JobV2.findOne({ applyLink, deletedAt: null }).lean();
    if (existing) {
        return { ok: false, errorCode: "DUPLICATE", existingJob: existing };
    }

    // 2-3. Fetch + clean (errors propagate as typed errors to caller)
    const { html } = await fetchHtml(applyLink);
    const cleaned = cleanHtml(html);

    // 4. Extract
    const { fields, confidence, warnings } = await extractJobFields(cleaned, applyLink);

    if (!fields || !fields.companyName || !fields.title) {
        return {
            ok: false,
            errorCode: "VALIDATION_FAILED",
            partialExtraction: fields,
            validationErrors: [{ message: "Missing required fields (title or companyName)" }],
        };
    }

    // 5. Resolve company
    const company = await resolveCompany(fields.companyName);
    if (company.wasCreated) {
        warnings.push(
            `Stub company created for "${fields.companyName}" — enrich via the company enrichment flow.`
        );
    }

    // 6. Slug
    const slug = await generateUniqueJobSlug(company.slug || fields.companyName, fields.title);

    // 7. Build doc
    const doc = buildJobDoc({ fields, applyLink, slug, company, postedBy });

    // 8. Validate
    const jobDocInstance = new JobV2(doc);
    try {
        await jobDocInstance.validate();
    } catch (err) {
        const validationErrors = err.errors
            ? Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }))
            : [{ message: err.message }];
        return {
            ok: false,
            errorCode: "VALIDATION_FAILED",
            partialExtraction: doc,
            validationErrors,
        };
    }

    // 9. Create
    const job = await JobV2.create(doc);

    // 10. Return
    return {
        ok: true,
        job,
        confidence,
        warnings,
        companyWasCreated: company.wasCreated,
    };
}

module.exports = { scrapeAndCreateJob, buildJobDoc };
