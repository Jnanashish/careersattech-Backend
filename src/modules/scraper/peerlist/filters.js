const {
    INDIAN_CITIES,
    INDIA_PHRASES,
    NON_INDIA_COUNTRIES,
    AMBIGUOUS_LOCATIONS,
    APPLYURL_BLOCKLIST,
    SOURCE_HOSTS,
    SENIORITY_TITLE_TERMS,
    MAX_SENIORITY_YEARS,
} = require("./constants");

const DROP = {
    APPLY: "filter1_apply",
    LOCATION: "filter2_location",
    SENIORITY: "filter3_seniority",
    IDENTITY: "filter4_peerlist_identity",
};

function parseUrlSafe(url) {
    if (!url || typeof url !== "string") return null;
    try {
        return new URL(url);
    } catch (_) {
        return null;
    }
}

function filter1_apply(record) {
    const url = parseUrlSafe(record.applyUrl);
    if (!url) return { keep: false, reason: DROP.APPLY, detail: "missing or invalid applyUrl" };
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        return { keep: false, reason: DROP.APPLY, detail: `bad protocol ${url.protocol}` };
    }

    const host = url.host.toLowerCase();
    if (APPLYURL_BLOCKLIST.includes(host)) {
        return { keep: false, reason: DROP.APPLY, detail: `host in blocklist: ${host}` };
    }
    if (SOURCE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
        return { keep: false, reason: DROP.APPLY, detail: `peerlist host: ${host}` };
    }

    const buttonText = String(record.applyButtonText || "").toLowerCase();
    if (
        buttonText.includes("apply via peerlist") ||
        buttonText.includes("apply on peerlist")
    ) {
        return { keep: false, reason: DROP.APPLY, detail: "button suggests internal peerlist apply" };
    }

    return { keep: true };
}

function locationPasses(rawLocation) {
    if (!rawLocation || typeof rawLocation !== "string") return false;
    const norm = rawLocation.toLowerCase().trim();
    if (!norm) return false;

    const parts = norm.split(/[,/|]+/).map((s) => s.trim()).filter(Boolean);

    const indiaQualified =
        /\bindia\b/.test(norm) ||
        INDIA_PHRASES.some((p) => norm.includes(p)) ||
        INDIAN_CITIES.some((c) => new RegExp(`\\b${c}\\b`, "i").test(norm));

    for (const country of NON_INDIA_COUNTRIES) {
        const re = new RegExp(`\\b${country.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        if (re.test(norm) && !indiaQualified) return false;
    }

    for (const part of parts) {
        if (part.includes("india")) return true;
        if (INDIA_PHRASES.some((p) => part.includes(p))) return true;
        if (INDIAN_CITIES.some((c) => part === c || part.includes(c))) return true;
    }

    if (parts.length === 1 && (parts[0] === "remote" || AMBIGUOUS_LOCATIONS.includes(parts[0]))) {
        return false;
    }
    if (parts.length === 1 && parts[0].startsWith("hybrid")) {
        return false;
    }

    return false;
}

function filter2_location(record) {
    if (locationPasses(record.location)) return { keep: true };
    return {
        keep: false,
        reason: DROP.LOCATION,
        detail: `location not India: "${record.location || ""}"`,
    };
}

function parseMinYears(experienceRange) {
    if (!experienceRange || typeof experienceRange !== "string") return 0;
    const s = experienceRange.toLowerCase().trim();

    if (/fresher|entry[- ]level|any experience|graduate/i.test(s)) return 0;

    const range = s.match(/(\d+)\s*[-–]\s*(\d+)/);
    if (range) return parseInt(range[1], 10);

    const plus = s.match(/(\d+)\s*\+/);
    if (plus) return parseInt(plus[1], 10);

    const single = s.match(/(\d+)\s*(?:years?|yrs?)/);
    if (single) return parseInt(single[1], 10);

    const bare = s.match(/^(\d+)$/);
    if (bare) return parseInt(bare[1], 10);

    return 0;
}

function titleHasSeniorityTerm(title) {
    if (!title || typeof title !== "string") return null;
    const lower = ` ${title.toLowerCase().replace(/[^\w. ]+/g, " ").replace(/\s+/g, " ")} `;
    for (const term of SENIORITY_TITLE_TERMS) {
        const t = term.trim();
        if (t === "sr.") {
            if (/\bsr\./i.test(title)) return "sr.";
            continue;
        }
        if (t === "sr") {
            if (/\bsr\s/i.test(title)) return "sr";
            continue;
        }
        const needle = ` ${t} `;
        if (lower.includes(needle)) return t;
    }
    return null;
}

function filter3_seniority(record) {
    const minYears = parseMinYears(record.experienceRange);
    if (minYears > MAX_SENIORITY_YEARS) {
        return {
            keep: false,
            reason: DROP.SENIORITY,
            detail: `min years ${minYears} > ${MAX_SENIORITY_YEARS}`,
        };
    }
    const hit = titleHasSeniorityTerm(record.title);
    if (hit) {
        return { keep: false, reason: DROP.SENIORITY, detail: `title contains "${hit}"` };
    }
    return { keep: true };
}

function filter4_identity(record) {
    const title = String(record.title || "").toLowerCase();
    const company = String(record.companyName || "").toLowerCase();
    const desc = String(record.descriptionSnippet || "").toLowerCase();

    if (/\bpeerlist\b/.test(title)) {
        return { keep: false, reason: DROP.IDENTITY, detail: "peerlist in title" };
    }
    if (/\bpeerlist\b/.test(company)) {
        return { keep: false, reason: DROP.IDENTITY, detail: "peerlist in company" };
    }
    if (/(hiring at peerlist|peerlist is hiring|join peerlist team|peerlist team)/i.test(desc)) {
        return { keep: false, reason: DROP.IDENTITY, detail: "description names peerlist as hirer" };
    }
    return { keep: true };
}

const PIPELINE = [filter1_apply, filter2_location, filter3_seniority, filter4_identity];

function applyAll(record) {
    for (const f of PIPELINE) {
        const out = f(record);
        if (!out.keep) return out;
    }
    return { keep: true };
}

module.exports = {
    DROP,
    filter1_apply,
    filter2_location,
    filter3_seniority,
    filter4_identity,
    applyAll,
    locationPasses,
    parseMinYears,
    titleHasSeniorityTerm,
};
