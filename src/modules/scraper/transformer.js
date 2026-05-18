const fs = require("fs");
const path = require("path");
const { getProvider } = require("./providers");

const SYSTEM_PROMPT = fs.readFileSync(
    path.join(__dirname, "prompts", "transformer.md"),
    "utf8"
);

const VALID_EMPLOYMENT_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACTOR", "INTERN", "TEMPORARY"];
const VALID_DISPLAY_MODES = ["internal", "external_redirect"];
const VALID_WORK_MODES = ["onsite", "hybrid", "remote"];
const VALID_CATEGORIES = ["engineering", "design", "product", "data", "devops", "qa", "management", "other"];
const VALID_APPLY_PLATFORMS = ["careerspage", "linkedin", "cuvette", "email", "other"];
const VALID_COMPANY_TYPES = ["product", "service", "startup", "mnc", "consulting", "unicorn", "bigtech", "other"];
const VALID_EMPLOYEE_BUCKETS = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5000+"];
const VALID_SALARY_UNITS = ["HOUR", "DAY", "WEEK", "MONTH", "YEAR"];
const VALID_TOPIC_TAGS = new Set([
    "software", "frontend", "backend", "fullstack", "web3", "devops", "testing",
    "app", "datascience", "analytics", "uiux", "ai", "ml", "android", "ios",
    "blockchain", "hacking", "security", "cloud",
]);

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function detectApplyPlatform(applyLink) {
    if (!applyLink || typeof applyLink !== "string") return "careerspage";
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

function arrayOfStrings(value, { lowercase = false, max = Infinity } = {}) {
    if (!Array.isArray(value)) return [];
    const out = [];
    for (const v of value) {
        if (typeof v !== "string") continue;
        const s = lowercase ? v.trim().toLowerCase() : v.trim();
        if (s) out.push(s);
        if (out.length >= max) break;
    }
    return out;
}

function normalizeJob(job, rawJob) {
    const out = { ...job };

    out.title = typeof out.title === "string" ? out.title.trim() : null;

    if (!out.applyLink || typeof out.applyLink !== "string") {
        out.applyLink = rawJob.companyPageUrl || rawJob.sourceUrl || "";
    }

    out.displayMode = VALID_DISPLAY_MODES.includes(out.displayMode) ? out.displayMode : "internal";

    if (!Array.isArray(out.employmentType) || out.employmentType.length === 0) {
        out.employmentType = ["FULL_TIME"];
    } else {
        out.employmentType = out.employmentType
            .map((t) => (typeof t === "string" ? t.toUpperCase().trim() : ""))
            .filter((t) => VALID_EMPLOYMENT_TYPES.includes(t));
        if (out.employmentType.length === 0) out.employmentType = ["FULL_TIME"];
    }

    const currentYear = new Date().getFullYear();
    if (!Array.isArray(out.batch) || out.batch.length === 0) {
        out.batch = [currentYear, currentYear - 1, currentYear - 2];
    } else {
        out.batch = [
            ...new Set(
                out.batch
                    .map((y) => parseInt(y, 10))
                    .filter((y) => Number.isInteger(y) && y >= 2020 && y <= 2030)
            ),
        ];
        if (out.batch.length === 0) out.batch = [currentYear, currentYear - 1, currentYear - 2];
    }

    if (!out.jobDescription || typeof out.jobDescription !== "object") {
        out.jobDescription = { html: "", plain: "" };
    }
    if (typeof out.jobDescription.html !== "string") out.jobDescription.html = "";
    if (typeof out.jobDescription.plain !== "string") {
        out.jobDescription.plain = out.jobDescription.html
            .replace(/<[^>]*>/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    out.category = VALID_CATEGORIES.includes(out.category) ? out.category : "other";
    out.workMode = VALID_WORK_MODES.includes(out.workMode) ? out.workMode : "onsite";

    out.degree = arrayOfStrings(out.degree, { max: 10 });

    if (!out.experience || typeof out.experience !== "object") {
        out.experience = { min: 0, max: 2 };
    } else {
        const min = parseInt(out.experience.min, 10);
        const max = parseInt(out.experience.max, 10);
        out.experience = {
            min: Number.isInteger(min) && min >= 0 ? min : 0,
            max: Number.isInteger(max) && max >= 0 ? max : 2,
        };
    }

    if (!Array.isArray(out.jobLocation)) out.jobLocation = [];
    out.jobLocation = out.jobLocation
        .map((loc) => {
            if (typeof loc === "string") return { city: loc.trim(), region: "", country: "IN" };
            if (loc && typeof loc === "object") {
                return {
                    city: typeof loc.city === "string" ? loc.city.trim() : "",
                    region: typeof loc.region === "string" ? loc.region.trim() : "",
                    country: typeof loc.country === "string" && loc.country.trim() ? loc.country.trim() : "IN",
                };
            }
            return null;
        })
        .filter((l) => l && l.city);

    const bs = out.baseSalary && typeof out.baseSalary === "object" ? out.baseSalary : {};
    out.baseSalary = {
        currency: typeof bs.currency === "string" && bs.currency.trim() ? bs.currency.trim().toUpperCase() : "INR",
        min: Number.isFinite(Number(bs.min)) ? Number(bs.min) : undefined,
        max: Number.isFinite(Number(bs.max)) ? Number(bs.max) : undefined,
        unitText: VALID_SALARY_UNITS.includes(bs.unitText) ? bs.unitText : "YEAR",
    };

    out.requiredSkills = arrayOfStrings(out.requiredSkills, { lowercase: true, max: 10 });
    out.preferredSkills = arrayOfStrings(out.preferredSkills, { lowercase: true, max: 5 });
    out.topicTags = arrayOfStrings(out.topicTags, { lowercase: true, max: 5 }).filter((t) =>
        VALID_TOPIC_TAGS.has(t)
    );

    out.applyPlatform = VALID_APPLY_PLATFORMS.includes(out.applyPlatform)
        ? out.applyPlatform
        : detectApplyPlatform(out.applyLink);

    if (out.datePosted && typeof out.datePosted === "string") {
        const d = new Date(out.datePosted);
        out.datePosted = isNaN(d.getTime()) ? null : d.toISOString();
    } else {
        out.datePosted = null;
    }
    if (out.validThrough && typeof out.validThrough === "string") {
        const d = new Date(out.validThrough);
        out.validThrough = isNaN(d.getTime()) ? null : d.toISOString();
    } else {
        out.validThrough = null;
    }

    out.externalJobId = typeof out.externalJobId === "string" && out.externalJobId.trim()
        ? out.externalJobId.trim()
        : null;

    return out;
}

function normalizeCompany(company, rawJob) {
    const out = company && typeof company === "object" ? { ...company } : {};

    out.companyName = typeof out.companyName === "string" ? out.companyName.trim() : null;

    const desc = out.description && typeof out.description === "object" ? out.description : {};
    out.description = {
        short: typeof desc.short === "string" ? desc.short.trim() : "",
        long: typeof desc.long === "string" ? desc.long.trim() : "",
    };

    out.companyType = VALID_COMPANY_TYPES.includes(out.companyType) ? out.companyType : "other";

    out.industry = typeof out.industry === "string" && out.industry.trim() ? out.industry.trim() : null;

    out.tags = arrayOfStrings(out.tags, { lowercase: true, max: 5 });
    out.techStack = arrayOfStrings(out.techStack, { lowercase: true, max: 10 });
    out.locations = arrayOfStrings(out.locations, { max: 10 });

    out.headquarters = typeof out.headquarters === "string" && out.headquarters.trim()
        ? out.headquarters.trim()
        : null;

    const fy = parseInt(out.foundedYear, 10);
    out.foundedYear = Number.isInteger(fy) && fy >= 1800 && fy <= new Date().getFullYear() ? fy : null;

    out.employeeCount = VALID_EMPLOYEE_BUCKETS.includes(out.employeeCount) ? out.employeeCount : null;

    out.website = typeof out.website === "string" && out.website.trim() ? out.website.trim() : null;
    out.careerPageLink = typeof out.careerPageLink === "string" && out.careerPageLink.trim()
        ? out.careerPageLink.trim()
        : rawJob.companyPageUrl || null;

    const sl = out.socialLinks && typeof out.socialLinks === "object" ? out.socialLinks : {};
    out.socialLinks = {
        linkedin: typeof sl.linkedin === "string" && sl.linkedin.trim() ? sl.linkedin.trim() : null,
        twitter: typeof sl.twitter === "string" && sl.twitter.trim() ? sl.twitter.trim() : null,
        instagram: typeof sl.instagram === "string" && sl.instagram.trim() ? sl.instagram.trim() : null,
        glassdoor: typeof sl.glassdoor === "string" && sl.glassdoor.trim() ? sl.glassdoor.trim() : null,
    };

    return out;
}

async function transform(rawJob) {
    const provider = getProvider();
    const maxAttempts = 3;

    const userMessage = JSON.stringify({
        sourceUrl: rawJob.sourceUrl,
        companyPageUrl: rawJob.companyPageUrl,
        meta: rawJob.meta,
        pageContent: rawJob.pageContent,
        companyPageContent: rawJob.companyPageContent,
    });

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            console.log(
                `[Transformer] Transforming job from ${rawJob.sourceUrl} (attempt ${attempt}, provider: ${provider.name})`
            );

            let response = await provider.complete(SYSTEM_PROMPT, userMessage);

            // Strip markdown code blocks if AI wraps in them
            response = response.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

            const parsed = JSON.parse(response);

            if (!parsed || typeof parsed !== "object") {
                throw new Error("AI response is not a JSON object");
            }
            if (!parsed.job || typeof parsed.job !== "object") {
                throw new Error("Missing required key: job");
            }
            if (!parsed.company || typeof parsed.company !== "object") {
                throw new Error("Missing required key: company");
            }

            const job = normalizeJob(parsed.job, rawJob);
            const company = normalizeCompany(parsed.company, rawJob);

            if (!job.title) throw new Error("Missing required field: job.title");
            if (!company.companyName) throw new Error("Missing required field: company.companyName");
            if (!job.applyLink) throw new Error("Missing required field: job.applyLink");
            if (job.displayMode === "internal" && !job.jobDescription.html) {
                throw new Error("job.jobDescription.html is required when displayMode is 'internal'");
            }

            console.log(`[Transformer] Successfully transformed: ${job.title} @ ${company.companyName}`);
            return { job, company };
        } catch (err) {
            console.error(
                `[Transformer] Attempt ${attempt} failed: ${err.message}`
            );
            if (attempt < maxAttempts) {
                const backoff = Math.pow(2, attempt) * 1000;
                console.log(`[Transformer] Retrying in ${backoff}ms...`);
                await delay(backoff);
            } else {
                throw new Error(
                    `[Transformer] All ${maxAttempts} attempts failed for ${rawJob.sourceUrl}: ${err.message}`
                );
            }
        }
    }
}

async function transformBatch(rawJobs) {
    const results = [];
    const errors = [];

    for (const rawJob of rawJobs) {
        try {
            const { job, company } = await transform(rawJob);
            results.push({
                ...rawJob,
                jobData: job,
                companyData: company,
            });
        } catch (err) {
            console.error(`[Transformer] Skipping job: ${err.message}`);
            errors.push({
                jobUrl: rawJob.sourceUrl,
                step: "transform",
                message: err.message,
            });
        }
    }

    return { results, errors };
}

module.exports = { transform, transformBatch, SYSTEM_PROMPT };
