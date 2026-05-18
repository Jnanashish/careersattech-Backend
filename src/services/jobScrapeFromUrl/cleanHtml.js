const cheerio = require("cheerio");

const MAX_LEN = 15_000;

const REMOVE_SELECTORS = [
    "script",
    "style",
    "noscript",
    "nav",
    "footer",
    "header",
    '[class*="cookie"]',
    '[class*="banner"]',
    '[class*="newsletter"]',
    '[aria-hidden="true"]',
];

const MAIN_SELECTORS = [
    '[itemtype*="JobPosting"]',
    "article",
    "main",
    '[class*="job-description"]',
    '[class*="job-detail"]',
    '[class*="posting"]',
    "body",
];

function truncate(s) {
    if (typeof s !== "string") return "";
    return s.length > MAX_LEN ? s.slice(0, MAX_LEN) : s;
}

function cleanHtml(html) {
    const $ = cheerio.load(html || "");

    for (const sel of REMOVE_SELECTORS) {
        $(sel).remove();
    }

    let scope = null;
    for (const sel of MAIN_SELECTORS) {
        const found = $(sel).first();
        if (found.length) {
            scope = found;
            break;
        }
    }
    if (!scope) scope = $.root();

    const text = scope.text().replace(/\s+/g, " ").trim();
    const htmlOut = scope.html() || "";

    return {
        text: truncate(text),
        html: truncate(htmlOut),
    };
}

module.exports = { cleanHtml };
