const axios = require("axios");
const cheerio = require("cheerio");
const { filterKnownUrls } = require("../ingester");
const { isStopRequested } = require("../stopFlags");
const { isPublicHttpsUrl } = require("../../../utils/urlGuard");
const logger = require("../../../utils/logger");

const API_URL = "https://backend.engineerhub.in/api/v1/getHiringByOpportunityType/";
const SOURCE_HOST = "engineerhub.in";

// One request per run: page 1, ten newest postings. The API returns newest
// first and this adapter runs once a day, so everything past the first ten was
// either ingested by an earlier run or is old enough that crawling deeper only
// burns requests re-reading rows dedupe rejects anyway.
const PAGE_NO = 1;
const PAGE_SIZE = 10;

const REQUEST_TIMEOUT_MS = 20000;
const MAX_PAGE_CONTENT = 16000;

// Freshers portal — a posting that starts above this many years of required
// experience is not for our audience.
const MAX_EXPERIENCE_YEARS = 5;

// Below this, `description` is a stub rather than a posting. Handing the
// transformer a stub under an "OFFICIAL JOB POSTING" heading invites it to
// invent the missing sections, so short text goes in as plain metadata and the
// prompt's "you only have the metadata" branch takes over.
const MIN_DESCRIPTION_CHARS = 200;

const DROP = {
    TYPE: "type",
    APPLY: "apply",
    LOCATION: "location",
    SENIORITY: "seniority",
    EXPIRED: "expired",
};

// The API returns ISO 3166-2:IN subdivision codes ("KA", "UP"). Google for Jobs
// wants a real region name in jobLocation.region, so expand the code here
// instead of hoping the LLM reads "KA" as Karnataka.
const IN_STATES = {
    AN: "Andaman and Nicobar Islands", AP: "Andhra Pradesh", AR: "Arunachal Pradesh",
    AS: "Assam", BR: "Bihar", CH: "Chandigarh", CT: "Chhattisgarh", CG: "Chhattisgarh",
    DH: "Dadra and Nagar Haveli and Daman and Diu", DL: "Delhi", GA: "Goa", GJ: "Gujarat",
    HR: "Haryana", HP: "Himachal Pradesh", JK: "Jammu and Kashmir", JH: "Jharkhand",
    KA: "Karnataka", KL: "Kerala", LA: "Ladakh", LD: "Lakshadweep", MP: "Madhya Pradesh",
    MH: "Maharashtra", MN: "Manipur", ML: "Meghalaya", MZ: "Mizoram", NL: "Nagaland",
    OR: "Odisha", OD: "Odisha", PY: "Puducherry", PB: "Punjab", RJ: "Rajasthan",
    SK: "Sikkim", TN: "Tamil Nadu", TG: "Telangana", TS: "Telangana", TR: "Tripura",
    UP: "Uttar Pradesh", UK: "Uttarakhand", UT: "Uttarakhand", WB: "West Bengal",
};

/**
 * The `description` field is TinyMCE-authored HTML full of entities
 * (&rsquo;, &nbsp;) and <ul>/<li> structure. Flatten it to text while keeping
 * the line breaks and "- " bullets — that shape is what the transformer turns
 * back into the <h3>/<ul> sections the JD template expects.
 */
function htmlToText(html) {
    if (typeof html !== "string" || !html.trim()) return "";

    const withBreaks = html
        .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
        .replace(/<\s*li[^>]*>/gi, "\n- ")
        .replace(/<\s*br\s*\/?\s*>/gi, "\n")
        .replace(/<\s*h[1-6][^>]*>/gi, "\n")
        .replace(/<\s*\/\s*(p|div|h[1-6]|li|ul|ol|tr|section)\s*>/gi, "\n");

    // cheerio does the entity decoding; a regex strip would leave &rsquo; behind.
    const text = cheerio.load(`<div>${withBreaks}</div>`).root().text();

    return text
        .split("\n")
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join("\n")
        .trim();
}

function pointsAtSource(url) {
    return typeof url === "string" && url.toLowerCase().includes(SOURCE_HOST);
}

function startOfTodayUtc() {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** "Bangalore Urban" is a district name; the city is Bangalore. */
function cleanCity(city) {
    return String(city || "").replace(/\s+(Urban|Rural)$/i, "").trim();
}

function formatLocation(record) {
    const parts = [cleanCity(record.city), IN_STATES[record.state] || record.state]
        .map((p) => String(p || "").trim())
        .filter(Boolean);
    if (record.country === "IN") parts.push("India");
    else if (record.country) parts.push(record.country);
    return parts.join(", ");
}

function formatSalary(record) {
    const { minRange, maxRange, salaryUnit, salaryDisclosure, showSalary } = record;
    if (showSalary === false) return null;
    if (!Number.isFinite(minRange) && !Number.isFinite(maxRange)) return null;

    const unit = salaryUnit || "LPA";
    const range = [minRange, maxRange].filter((n) => Number.isFinite(n)).join(" - ");
    // The source publishes a range even when it flags the pay as undisclosed —
    // that range is its own estimate, so label it rather than presenting it as
    // the company's stated offer.
    const undisclosed = /not\s*disclosed/i.test(String(salaryDisclosure || ""));
    return undisclosed
        ? `Salary (range estimated by the listing, employer did not disclose): ${range} ${unit}`
        : `Salary: ${range} ${unit}`;
}

function formatExperience(record) {
    const { minExperience: min, maxExperience: max } = record;
    if (!Number.isFinite(min) && !Number.isFinite(max)) return null;
    if (Number.isFinite(min) && Number.isFinite(max)) return `Experience Required: ${min} - ${max} years`;
    return `Experience Required: ${Number.isFinite(min) ? `${min}+` : `up to ${max}`} years`;
}

function formatPageContent(record) {
    const description = htmlToText(record.description);

    const parts = [
        `Job Title: ${record.opportunityName}`,
        `Company: ${record.organisationName}`,
        `Location: ${formatLocation(record) || "Not specified"}`,
        `Job Type: ${record.opportunityMode || "Not specified"}`,
        `Work Mode: ${record.opportunityLocation || "Not specified"}`,
    ];

    const experience = formatExperience(record);
    if (experience) parts.push(experience);
    if (record.isForFreshers === true) parts.push("Open to freshers: Yes");

    const salary = formatSalary(record);
    if (salary) parts.push(salary);

    if (Array.isArray(record.skillsRequired) && record.skillsRequired.length > 0) {
        parts.push(`Skills: ${record.skillsRequired.join(", ")}`);
    }
    if (record.eligibility) parts.push(`Eligibility: ${record.eligibility}`);
    if (Number.isFinite(record.openings)) parts.push(`Openings: ${record.openings}`);

    parts.push("", `Apply URL: ${record.applyLink}`);
    if (record.applicationStartTime) parts.push(`Applications Open: ${record.applicationStartTime}`);
    if (record.applicationEndTime) parts.push(`Application Deadline: ${record.applicationEndTime}`);
    if (record.createdAt) parts.push(`Posted: ${record.createdAt}`);

    // Long-form content goes last so the length cap trims the tail of the
    // description rather than eating the metadata above it.
    if (description.length >= MIN_DESCRIPTION_CHARS) {
        // Unlike the HTML adapters, this text is not scraped off a listing page
        // — it is the posting body the source publishes for this role, so the
        // transformer should treat it as authoritative.
        parts.push("", "OFFICIAL JOB POSTING (as published for this role):", description);
    } else if (description) {
        parts.push("", "Job Description:", description);
    }

    return parts.join("\n").slice(0, MAX_PAGE_CONTENT);
}

/**
 * Decide whether a raw API record is one we want. Returns null to keep, or the
 * DROP reason to discard.
 */
function dropReason(record) {
    if (record.opportunityType && record.opportunityType !== "Job") return DROP.TYPE;

    const applyLink = typeof record.applyLink === "string" ? record.applyLink.trim() : "";
    // isPublicHttpsUrl also rejects mailto:, http:// and anything internal, so
    // an apply link that survives here is safe to hand a public redirect to.
    if (!applyLink || !isPublicHttpsUrl(applyLink) || pointsAtSource(applyLink)) return DROP.APPLY;

    if (record.country && record.country !== "IN") return DROP.LOCATION;

    if (Number.isFinite(record.minExperience) && record.minExperience > MAX_EXPERIENCE_YEARS) {
        return DROP.SENIORITY;
    }

    // A posting whose window already closed would be published and then
    // hard-deleted by the next apply-link sweep. Skip it here instead.
    if (record.applicationEndTime) {
        const end = new Date(record.applicationEndTime);
        if (!isNaN(end.getTime()) && end < startOfTodayUtc()) return DROP.EXPIRED;
    }

    return null;
}

module.exports = {
    name: "engineerhub",
    displayName: "EngineerHub",
    baseUrl: "https://engineerhub.in",
    enabled: true,

    // Placeholders — scrape() below drives everything; there is no HTML to
    // select against. jobLinks.limit is still the cap the pipeline passes in.
    selectors: { jobLinks: { limit: PAGE_SIZE }, companyUrl: {}, meta: {} },
    options: { delayMs: 0, headers: {}, pagination: { enabled: false, maxPages: 1 } },

    notes:
        "JSON API source (getHiringByOpportunityType). One request per run: pageNo=1&limit=10, " +
        "newest first. Records carry the full JD body, a direct company/ATS apply link, salary " +
        "range, experience band and skills, so no apply-page fetch is needed. India-only, " +
        `≤${MAX_EXPERIENCE_YEARS}y experience, open application window. The source's logo URLs ` +
        "are deliberately not carried over — they are hotlinks into its own S3 bucket.",

    htmlToText,
    formatPageContent,
    dropReason,

    async scrape(options = {}) {
        const limit = options.limit || this.selectors.jobLinks.limit;
        const stats = {
            jobLinksFound: 0,
            jobsFetched: 0,
            errors: [],
            dropCounts: {
                [DROP.TYPE]: 0,
                [DROP.APPLY]: 0,
                [DROP.LOCATION]: 0,
                [DROP.SENIORITY]: 0,
                [DROP.EXPIRED]: 0,
            },
        };
        const jobs = [];

        if (isStopRequested(this.name)) {
            logger.info("[engineerhub] stop requested, skipping run");
            return { jobs, stats: { ...stats, stopped: true } };
        }

        let payload;
        try {
            const response = await axios.get(API_URL, {
                params: { search: "", opportunityType: "Job", pageNo: PAGE_NO, limit: PAGE_SIZE },
                timeout: REQUEST_TIMEOUT_MS,
                headers: { Accept: "application/json" },
            });
            payload = response.data;
        } catch (err) {
            stats.errors.push({ jobUrl: API_URL, step: "fetch", message: err.message });
            logger.warn(`[engineerhub] API fetch failed: ${err.message}`);
            return { jobs, stats };
        }

        if (!payload || payload.success !== true || !Array.isArray(payload.data)) {
            stats.errors.push({
                jobUrl: API_URL,
                step: "fetch",
                message: "API returned an unsuccessful or malformed response",
            });
            return { jobs, stats };
        }

        const records = payload.data;
        stats.jobLinksFound = records.length;

        const passing = [];
        for (const record of records) {
            const reason = dropReason(record);
            if (reason) {
                stats.dropCounts[reason] = (stats.dropCounts[reason] || 0) + 1;
                continue;
            }
            passing.push(record);
        }

        // sourceUrl is the apply link, not an engineerhub.in permalink: that is
        // the field filterKnownUrls matches against JobV2.applyLink, so using it
        // catches a job we already published from any source before it costs an
        // LLM call.
        const applyLinks = passing.map((r) => r.applyLink.trim());
        const knownUrls = applyLinks.length ? await filterKnownUrls(applyLinks) : new Set();

        for (const record of passing) {
            if (jobs.length >= limit) break;
            if (isStopRequested(this.name)) {
                logger.info("[engineerhub] stop requested, aborting record loop");
                stats.stopped = true;
                break;
            }

            const applyLink = record.applyLink.trim();
            if (knownUrls.has(applyLink)) continue;

            jobs.push({
                source: this.name,
                sourceUrl: applyLink,
                companyPageUrl: typeof record.websiteUrl === "string" && record.websiteUrl.trim()
                    ? record.websiteUrl.trim()
                    : null,
                // The source's own id is stable, so hand it to the transformer
                // rather than letting the LLM guess a requisition id off the
                // body — this is what the ingester's first dedupe layer matches.
                externalJobId: record._id ? `engineerhub:${record._id}` : null,
                meta: {
                    title: record.opportunityName || null,
                    company: record.organisationName || null,
                    postedDate: record.createdAt || null,
                },
                pageContent: formatPageContent(record),
                // Nothing to fetch: the API record already carries the posting
                // body, and websiteUrl is a homepage, not a JD.
                companyPageContent: null,
            });
            stats.jobsFetched++;
        }

        logger.info(
            `[engineerhub] scrape done: returned=${stats.jobLinksFound} kept=${passing.length} ` +
            `new=${stats.jobsFetched} alreadyKnown=${knownUrls.size} ` +
            `drops=${JSON.stringify(stats.dropCounts)}`
        );

        return { jobs, stats };
    },
};
