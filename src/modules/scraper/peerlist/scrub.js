const { SCRUB_PHRASES, SOURCE_HOSTS } = require("./constants");

function scrubText(value) {
    if (value == null) return value;
    if (typeof value !== "string") return value;
    let out = value;
    for (const phrase of SCRUB_PHRASES) {
        const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
        out = out.replace(re, "");
    }
    out = out.replace(/[ \t]{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
    return out;
}

function scrubArray(arr) {
    if (!Array.isArray(arr)) return arr;
    return arr.map((v) => (typeof v === "string" ? scrubText(v) : v)).filter((v) => v !== "");
}

function containsSourceHost(value) {
    if (!value || typeof value !== "string") return false;
    const lower = value.toLowerCase();
    return SOURCE_HOSTS.some((h) => lower.includes(h));
}

function scrubRecord(record) {
    const out = { ...record };
    if (typeof out.title === "string") out.title = scrubText(out.title);
    if (typeof out.companyName === "string") out.companyName = scrubText(out.companyName);
    if (typeof out.location === "string") out.location = scrubText(out.location);
    if (typeof out.descriptionSnippet === "string") {
        out.descriptionSnippet = scrubText(out.descriptionSnippet);
    }
    if (typeof out.compensation === "string") out.compensation = scrubText(out.compensation);
    if (Array.isArray(out.skills)) out.skills = scrubArray(out.skills);
    return out;
}

module.exports = { scrubText, scrubArray, scrubRecord, containsSourceHost };
