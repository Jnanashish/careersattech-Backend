const cheerio = require("cheerio");
const logger = require("../../utils/logger");

// Aggregator list APIs (OnlyFrontendJobs, Peerlist) expose only title, company,
// location and tech stack — there is no description field on the record. Fed
// that alone the transformer LLM has nothing to build a JD from, and because
// the prompt forbids inventing content it correctly emits a ~40-word stub. So
// we follow the apply link to the company's own posting and hand the
// transformer that instead.

const MAX_APPLY_CONTENT = 12000;

// Under this, extraction almost certainly landed on an unrendered SPA shell
// (Workday, SmartRecruiters, Workable all return ~15 chars of body text)
// rather than a real posting. Returning null lets the caller keep its
// aggregator metadata instead of feeding the LLM a page of nav chrome.
const MIN_USEFUL_CONTENT = 400;

const CHROME_SELECTOR =
    "script, style, noscript, iframe, svg, nav, header, footer, aside, form";

const BLOCK_SELECTOR = "p, div, section, article, tr, h1, h2, h3, h4, h5, h6";

const MAIN_CONTENT_SELECTORS = [
    '[itemtype*="JobPosting"]',
    '[itemprop="description"]',
    "main",
    '[role="main"]',
    "#content",
    "article",
];

// Narrow to the posting before flattening. Franke's SuccessFactors page opens
// with ~1100 chars of German site menu that survives a <nav>/<header> strip
// because the menu is built from plain <ul>/<div>. Requiring the candidate to
// hold a posting's worth of text avoids the opposite failure — latching onto a
// tiny "related jobs" <article> and dropping the real description, which is
// what the first-match-wins picker in jobScrapeFromUrl/cleanHtml does today.
function scopeToMainContent($) {
    for (const selector of MAIN_CONTENT_SELECTORS) {
        const nodes = $(selector);
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes.eq(i);
            if (node.text().replace(/\s+/g, " ").trim().length >= MIN_USEFUL_CONTENT) return node;
        }
    }
    return null;
}

function truncateAtBoundary(text, maxLength) {
    if (text.length <= maxLength) return text;
    const cut = text.slice(0, maxLength);
    const boundary = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(" "));
    return (boundary > maxLength * 0.8 ? cut.slice(0, boundary) : cut).trim();
}

// Flatten to plain text while keeping the line breaks the LLM uses to tell
// headings from bullets. A blind $.text() glues every list item into one run-on
// sentence, which is most of why the earlier extractions read as mush.
function htmlToText(html, { scopeToMain = false } = {}) {
    const $ = cheerio.load(String(html || ""));
    $(CHROME_SELECTOR).remove();

    const scope = scopeToMain ? scopeToMainContent($) : null;
    const root = scope || $.root();
    const within = (selector) => (scope ? scope.find(selector) : $(selector));

    within("br").replaceWith("\n");
    within("li").each((_, el) => $(el).prepend("\n- "));
    within(BLOCK_SELECTOR).each((_, el) => $(el).append("\n"));

    return root
        .text()
        .replace(/\r/g, "")
        .replace(/[ \t\u00a0]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function asNodes(parsed) {
    if (Array.isArray(parsed)) return parsed.flatMap(asNodes);
    if (parsed && typeof parsed === "object") {
        if (Array.isArray(parsed["@graph"])) return parsed["@graph"].flatMap(asNodes);
        return [parsed];
    }
    return [];
}

function isJobPosting(node) {
    const type = node && node["@type"];
    return type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"));
}

// Most ATS platforms (Ashby, Lever, Rippling, Adobe, Greenhouse) publish a
// schema.org JobPosting block for Google for Jobs. It is cleaner than the
// rendered page and, on SPA hosts like Ashby, it is the only copy of the
// description in the initial HTML at all.
function extractJobPostingLd(html) {
    const $ = cheerio.load(String(html || ""));
    let best = null;
    let bestLength = -1;

    $('script[type="application/ld+json"]').each((_, el) => {
        const raw = $(el).contents().text();
        if (!raw || !raw.includes("JobPosting")) return;

        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            return;
        }

        for (const node of asNodes(parsed)) {
            if (!isJobPosting(node)) continue;
            const length = typeof node.description === "string" ? node.description.length : 0;
            if (length > bestLength) {
                best = node;
                bestLength = length;
            }
        }
    });

    return best;
}

function ldLocations(node) {
    const raw = node.jobLocation;
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const out = [];
    for (const entry of list) {
        const address = (entry && entry.address) || entry;
        if (!address || typeof address !== "object") continue;
        const parts = [address.addressLocality, address.addressRegion, address.addressCountry]
            .map((v) => (v && typeof v === "object" ? v.name : v))
            .filter((v) => typeof v === "string" && v.trim());
        if (parts.length) out.push(parts.join(", "));
    }
    return out;
}

function ldSalary(node) {
    const salary = node.baseSalary;
    if (!salary || typeof salary !== "object") return null;
    const value = salary.value && typeof salary.value === "object" ? salary.value : salary;
    const min = value.minValue != null ? value.minValue : value.value;
    const max = value.maxValue != null ? value.maxValue : value.value;
    if (min == null && max == null) return null;
    const currency = salary.currency || value.currency || "";
    const unit = value.unitText ? ` per ${String(value.unitText).toLowerCase()}` : "";
    const range =
        min != null && max != null && String(min) !== String(max)
            ? `${min} - ${max}`
            : String(min != null ? min : max);
    return `${currency} ${range}${unit}`.trim();
}

// The structured fields matter beyond the prose: datePosted, validThrough and
// baseSalary are exactly the Google-for-Jobs fields the LLM was previously
// guessing at (or defaulting) because nothing in the input carried them.
function formatJobPostingLd(node) {
    const lines = [];
    const push = (label, value) => {
        if (value != null && String(value).trim()) lines.push(`${label}: ${String(value).trim()}`);
    };

    push("Job Title", node.title);
    push("Company", node.hiringOrganization && node.hiringOrganization.name);
    push(
        "Employment Type",
        Array.isArray(node.employmentType) ? node.employmentType.join(", ") : node.employmentType
    );
    push("Date Posted", node.datePosted);
    push("Valid Through", node.validThrough);
    push("Location", ldLocations(node).join(" | "));
    if (node.jobLocationType === "TELECOMMUTE") push("Work Mode", "Remote");
    push("Salary", ldSalary(node));
    push("Experience Required", node.experienceRequirements && node.experienceRequirements.monthsOfExperience
        ? `${node.experienceRequirements.monthsOfExperience} months`
        : null);

    const description = htmlToText(node.description);
    if (description) lines.push("", "Job Description:", description);

    return lines.join("\n").trim();
}

/**
 * Turn a fetched apply-page HTML document into transformer-ready text.
 * Prefers the schema.org JobPosting block, falls back to the rendered body.
 * Returns null when neither yields enough content to be worth sending.
 */
function buildApplyPageContent(html, { maxLength = MAX_APPLY_CONTENT } = {}) {
    const posting = extractJobPostingLd(html);
    if (posting) {
        const text = formatJobPostingLd(posting);
        if (text.length >= MIN_USEFUL_CONTENT) {
            return { text: truncateAtBoundary(text, maxLength), extractedFrom: "jsonld" };
        }
    }

    const text = htmlToText(html, { scopeToMain: true });
    if (text.length >= MIN_USEFUL_CONTENT) {
        return { text: truncateAtBoundary(text, maxLength), extractedFrom: "html" };
    }

    return null;
}

/**
 * Fetch a company's own job posting and extract its description.
 *
 * Goes through scraper.fetch's fetchPage so third-party apply URLs keep the
 * SSRF guard, ScraperAPI key rotation and direct-fetch fallback. The require is
 * lazy because scraper.fetch loads ./adapters, and adapters load this module.
 *
 * Never throws — a dead or bot-walled apply page must not take down the run.
 */
async function fetchApplyPageContent(applyUrl, { fetchPageImpl, maxLength } = {}) {
    if (!applyUrl || typeof applyUrl !== "string") return null;

    const fetchPage = fetchPageImpl || require("./scraper.fetch").fetchPage;

    let html;
    try {
        html = await fetchPage(applyUrl, {});
    } catch (err) {
        logger.info(`[ApplyPage] fetch failed for ${applyUrl}: ${err.message}`);
        return null;
    }

    let result;
    try {
        result = buildApplyPageContent(html, { maxLength });
    } catch (err) {
        logger.info(`[ApplyPage] extraction failed for ${applyUrl}: ${err.message}`);
        return null;
    }

    if (!result) {
        logger.info(`[ApplyPage] no usable description at ${applyUrl} (likely a JS-rendered ATS)`);
        return null;
    }

    logger.info(
        `[ApplyPage] extracted ${result.text.length} chars via ${result.extractedFrom} from ${applyUrl}`
    );
    return result;
}

module.exports = {
    fetchApplyPageContent,
    buildApplyPageContent,
    extractJobPostingLd,
    formatJobPostingLd,
    htmlToText,
    MAX_APPLY_CONTENT,
    MIN_USEFUL_CONTENT,
};
