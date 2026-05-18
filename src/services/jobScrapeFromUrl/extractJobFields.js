const { z } = require("zod");
const JobV2 = require("../../modules/jobsV2/jobsV2.model");
const { getProvider } = require("../../modules/scraper/providers");

class ExtractionFailedError extends Error {
    constructor(message, { rawResponse } = {}) {
        super(message);
        this.name = "ExtractionFailedError";
        this.rawResponse = rawResponse;
    }
}

const EMPLOYMENT_TYPE = ["FULL_TIME", "PART_TIME", "CONTRACTOR", "INTERN", "TEMPORARY"];
const SALARY_UNIT = ["HOUR", "DAY", "WEEK", "MONTH", "YEAR"];
const WORK_MODE = ["onsite", "hybrid", "remote"];
const CATEGORY = ["engineering", "design", "product", "data", "devops", "qa", "management", "other"];

// Reflect a subset of JobV2 paths into a JSON spec the LLM can follow.
function buildSchemaSpec() {
    const paths = JobV2.schema.paths;
    const spec = {};
    for (const [pathName, def] of Object.entries(paths)) {
        if (pathName.startsWith("_")
            || pathName === "createdAt"
            || pathName === "updatedAt"
            || pathName === "slug"
            || pathName === "company"
            || pathName === "deletedAt"
            || pathName === "publishedAt"
            || pathName === "approvedBy"
            || pathName === "approvedFromStagingId"
            || pathName === "archivedAt"
            || pathName === "archivedReason"
            || pathName.startsWith("verification")
            || pathName.startsWith("stats")
            || pathName.startsWith("sponsorship")
            || pathName.startsWith("seo")
            || pathName === "isVerified"
            || pathName === "priority"
            || pathName === "status"
            || pathName === "source"
            || pathName === "postedBy"
            || pathName === "externalJobId"
            || pathName === "jdBanner") {
            continue;
        }
        const opts = def.options || {};
        const isArray = Array.isArray(opts.type);
        let typeName = "string";
        const inner = isArray ? opts.type[0] : opts.type;
        if (inner === Number) typeName = "number";
        else if (inner === Boolean) typeName = "boolean";
        else if (inner === Date) typeName = "iso-date-string";
        else if (typeof inner === "object" && inner !== null) typeName = "object";

        spec[pathName] = {
            type: isArray ? `${typeName}[]` : typeName,
            required: !!def.isRequired,
            enum: opts.enum
                ? (Array.isArray(opts.enum) ? opts.enum : opts.enum.values).filter((v) => v !== null)
                : undefined,
        };
    }
    return spec;
}

let cachedSpec = null;
function getSpec() {
    if (!cachedSpec) cachedSpec = buildSchemaSpec();
    return cachedSpec;
}

const SYSTEM_PROMPT =
    "You extract structured job posting data from HTML. " +
    "Return only valid JSON matching the schema. " +
    "Use null for any field you cannot find explicitly stated in the page. " +
    "Do not infer or guess.";

const EXTRACTION_RULES = `
Extraction rules:
- companyName: exactly as written on the page, no normalisation.
- title: the job title only — no location suffixes.
- employmentType: array; map to schema enum (FULL_TIME, PART_TIME, CONTRACTOR, INTERN, TEMPORARY).
- jobLocation: array of { city, region, country }; if "remote" / "work from home" / similar is mentioned, also set workMode="remote".
- workMode: one of onsite|hybrid|remote, or null if not stated.
- baseSalary: { currency, min, max, unitText } only if explicitly written; null otherwise.
- datePosted: ISO date string if a posted date is visible on the page; null otherwise.
- validThrough: ISO date if an apply-by/expiry date is visible; null otherwise.
- requiredSkills / preferredSkills: only items explicitly listed; empty array otherwise.
- topicTags: short topic labels (e.g. frontend, backend, ai); empty array otherwise.
- jobDescription: { html, plain } — full job description; plain text in plain, basic HTML in html.
- experience: { min, max } in years if stated; otherwise omit.
- category: one of engineering|design|product|data|devops|qa|management|other.
- batch: array of integer years (2020-2030) for batch eligibility; omit if not stated.
- degree: array of degree strings; empty if not stated.

Output JSON only. No preamble. No markdown fences.
`.trim();

function stripFences(s) {
    if (typeof s !== "string") return "";
    return s.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
}

// Zod soft-validator — required JobV2 fields. Optional fields are tolerated.
const extractedJobSchema = z.object({
    title: z.string().min(1),
    companyName: z.string().min(1),
    employmentType: z.array(z.enum(EMPLOYMENT_TYPE)).min(1),
    batch: z.array(z.number().int().min(2020).max(2030)).min(1).optional(),
    jobDescription: z.object({
        html: z.string().optional().nullable(),
        plain: z.string().optional().nullable(),
    }).optional().nullable(),
    workMode: z.enum(WORK_MODE).optional().nullable(),
    category: z.enum(CATEGORY).optional().nullable(),
    degree: z.array(z.string()).optional().nullable(),
    experience: z.object({
        min: z.number().optional(),
        max: z.number().optional(),
    }).optional().nullable(),
    jobLocation: z.array(z.object({
        city: z.string().optional().nullable(),
        region: z.string().optional().nullable(),
        country: z.string().optional().nullable(),
    })).optional().nullable(),
    baseSalary: z.object({
        currency: z.string().optional().nullable(),
        min: z.number().optional().nullable(),
        max: z.number().optional().nullable(),
        unitText: z.enum(SALARY_UNIT).optional().nullable(),
    }).optional().nullable(),
    requiredSkills: z.array(z.string()).optional().nullable(),
    preferredSkills: z.array(z.string()).optional().nullable(),
    topicTags: z.array(z.string()).optional().nullable(),
    datePosted: z.string().optional().nullable(),
    validThrough: z.string().optional().nullable(),
}).passthrough();

function computeConfidence(fields, warnings) {
    const requiredOk = fields.title && fields.companyName
        && Array.isArray(fields.employmentType) && fields.employmentType.length > 0;
    if (!requiredOk) return "low";

    const descLen = fields.jobDescription?.plain?.length
        || fields.jobDescription?.html?.length
        || 0;
    if (descLen < 200) {
        warnings.push("Job description shorter than 200 chars");
        return "low";
    }

    const seoFlags = [
        !!fields.datePosted,
        !!fields.validThrough,
        !!fields.baseSalary && (fields.baseSalary.min || fields.baseSalary.max),
        Array.isArray(fields.jobLocation) && fields.jobLocation.length > 0,
    ];
    const seoCount = seoFlags.filter(Boolean).length;

    const hasEmployment = Array.isArray(fields.employmentType) && fields.employmentType.length > 0;
    const hasSalaryOrLocation = seoFlags[2] || seoFlags[3];

    if (fields.datePosted && hasEmployment && hasSalaryOrLocation) return "high";
    if (seoCount >= 2) return "medium";
    return "medium";
}

async function extractJobFields(cleaned, sourceUrl) {
    const spec = getSpec();
    const userMessage = [
        "SCHEMA SPEC (target JSON shape — keys with required:true MUST be present):",
        JSON.stringify(spec, null, 2),
        "",
        `SOURCE URL: ${sourceUrl}`,
        "",
        "PAGE TEXT:",
        cleaned.text,
        "",
        "PAGE HTML SNIPPET:",
        cleaned.html,
        "",
        EXTRACTION_RULES,
    ].join("\n");

    const provider = getProvider();
    let raw;
    try {
        raw = await provider.complete(SYSTEM_PROMPT, userMessage);
    } catch (err) {
        throw new ExtractionFailedError(`AI provider error: ${err.message}`);
    }

    const cleanedResponse = stripFences(raw);
    let parsed;
    try {
        parsed = JSON.parse(cleanedResponse);
    } catch (err) {
        throw new ExtractionFailedError(`AI response is not valid JSON: ${err.message}`, {
            rawResponse: cleanedResponse,
        });
    }

    const result = extractedJobSchema.safeParse(parsed);
    const warnings = [];
    let fields;
    if (!result.success) {
        warnings.push(
            "Zod soft-validation reported issues: " +
            result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
        );
        fields = parsed;
    } else {
        fields = result.data;
    }

    const confidence = computeConfidence(fields, warnings);
    return { fields, confidence, warnings };
}

module.exports = {
    extractJobFields,
    ExtractionFailedError,
    buildSchemaSpec,
    computeConfidence,
};
