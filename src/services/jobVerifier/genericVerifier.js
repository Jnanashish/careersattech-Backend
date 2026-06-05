const { fetchUrl } = require("./httpClient");
const EXPIRED_PHRASES = require("./expiredPhrases");

const CAPTCHA_MARKERS = [
    "captcha",
    "cloudflare",
    "please verify you are human",
    "checking your browser",
    "access denied",
];

const CAREER_HOMEPAGE_PATHS = /^\/(careers?|jobs)\/?$/i;
const MIN_BODY_LENGTH = 200;

/**
 * @typedef {Object} VerificationResult
 * @property {"expired"|"active"} result
 * @property {string} reason
 * @property {number|null} statusCode
 * @property {string|null} finalUrl
 * @property {number} durationMs
 */

function stripHtml(body) {
    return String(body || "")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

function lostJobIdHeuristic(originalUrl, finalUrl) {
    try {
        const a = new URL(originalUrl);
        const b = new URL(finalUrl);
        if (a.hostname !== b.hostname) return false;
        if (a.pathname === b.pathname) return false;
        // original had path segments beyond /careers; final collapsed to homepage
        return CAREER_HOMEPAGE_PATHS.test(b.pathname) && !CAREER_HOMEPAGE_PATHS.test(a.pathname);
    } catch (_) {
        return false;
    }
}

function looksLikeCareersHomepage(originalUrl, finalUrl) {
    if (!finalUrl) return false;
    try {
        const u = new URL(finalUrl);
        if (CAREER_HOMEPAGE_PATHS.test(u.pathname)) return true;
    } catch (_) {
        return false;
    }
    return lostJobIdHeuristic(originalUrl, finalUrl);
}

function matchedPhrase(text) {
    for (const phrase of EXPIRED_PHRASES) {
        if (text.includes(phrase)) return phrase;
    }
    return null;
}

function matchedCaptcha(text) {
    for (const marker of CAPTCHA_MARKERS) {
        if (text.includes(marker)) return marker;
    }
    return null;
}

/**
 * Classify the apply URL.
 * @param {string} url
 * @returns {Promise<VerificationResult>}
 */
async function verifyApplyUrl(url) {
    const startedAt = Date.now();

    if (!url || typeof url !== "string") {
        return {
            result: "active",
            reason: "error:missing-url",
            statusCode: null,
            finalUrl: null,
            durationMs: 0,
        };
    }

    const { statusCode, finalUrl, body, error } = await fetchUrl(url);
    const durationMs = Date.now() - startedAt;

    if (error) {
        const reason = error.type === "timeout" ? "timeout" : `error:${error.type}`;
        return { result: "active", reason, statusCode: null, finalUrl: null, durationMs };
    }

    if (statusCode === 404 || statusCode === 410) {
        return {
            result: "expired",
            reason: `status:${statusCode}`,
            statusCode,
            finalUrl,
            durationMs,
        };
    }

    if (statusCode >= 500 && statusCode < 600) {
        return {
            result: "active",
            reason: `status:5xx:${statusCode}`,
            statusCode,
            finalUrl,
            durationMs,
        };
    }

    const text = stripHtml(body);

    const captcha = matchedCaptcha(text);
    if (captcha) {
        return {
            result: "active",
            reason: "captcha-or-bot-wall",
            statusCode,
            finalUrl,
            durationMs,
        };
    }

    const phrase = matchedPhrase(text);
    if (phrase) {
        return {
            result: "expired",
            reason: `phrase:${phrase}`,
            statusCode,
            finalUrl,
            durationMs,
        };
    }

    if (looksLikeCareersHomepage(url, finalUrl)) {
        return {
            result: "expired",
            reason: "redirect-to-careers-home",
            statusCode,
            finalUrl,
            durationMs,
        };
    }

    if (text.length < MIN_BODY_LENGTH) {
        return {
            result: "active",
            reason: "empty-body",
            statusCode,
            finalUrl,
            durationMs,
        };
    }

    return {
        result: "active",
        reason: "no-expired-markers",
        statusCode,
        finalUrl,
        durationMs,
    };
}

module.exports = {
    verifyApplyUrl,
    _internals: {
        stripHtml,
        matchedPhrase,
        matchedCaptcha,
        looksLikeCareersHomepage,
        EXPIRED_PHRASES,
        CAPTCHA_MARKERS,
        CAREER_HOMEPAGE_PATHS,
        MIN_BODY_LENGTH,
    },
};
