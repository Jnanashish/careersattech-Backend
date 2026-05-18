const axios = require("axios");

const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DEFAULT_MAX_BYTES = 5_000_000;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

class FetchBlockedError extends Error {
    constructor(message, { status, url } = {}) {
        super(message);
        this.name = "FetchBlockedError";
        this.status = status;
        this.url = url;
    }
}

class FetchFailedError extends Error {
    constructor(message, { status, url, cause } = {}) {
        super(message);
        this.name = "FetchFailedError";
        this.status = status;
        this.url = url;
        if (cause) this.cause = cause;
    }
}

class FetchTooLargeError extends Error {
    constructor(message, { url } = {}) {
        super(message);
        this.name = "FetchTooLargeError";
        this.url = url;
    }
}

class FetchTimeoutError extends Error {
    constructor(message, { url } = {}) {
        super(message);
        this.name = "FetchTimeoutError";
        this.url = url;
    }
}

const CLOUDFLARE_SIGNATURES = [
    "Just a moment...",
    "Checking if the site connection is secure",
    "cf-browser-verification",
    "Attention Required! | Cloudflare",
    "Please enable cookies",
    "__cf_chl_",
];

function looksLikeChallenge(body) {
    if (typeof body !== "string") return false;
    return CLOUDFLARE_SIGNATURES.some((sig) => body.includes(sig));
}

async function fetchHtml(url, options = {}) {
    const maxBytes = options.maxBytes
        || Number(process.env.MAX_SCRAPE_HTML_BYTES)
        || DEFAULT_MAX_BYTES;

    let response;
    try {
        response = await axios.get(url, {
            timeout: TIMEOUT_MS,
            maxRedirects: MAX_REDIRECTS,
            maxContentLength: maxBytes,
            maxBodyLength: maxBytes,
            responseType: "text",
            transformResponse: [(data) => data],
            validateStatus: () => true,
            headers: {
                "User-Agent": USER_AGENT,
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            },
        });
    } catch (err) {
        if (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT") {
            throw new FetchTimeoutError(`Fetch timed out after ${TIMEOUT_MS}ms`, { url });
        }
        if (err.code === "ERR_FR_MAX_CONTENT_LENGTH_EXCEEDED"
            || err.code === "ERR_FR_MAX_BODY_LENGTH_EXCEEDED"
            || /maxContentLength|maxBodyLength/i.test(String(err.message))) {
            throw new FetchTooLargeError(`Response exceeded ${maxBytes} bytes`, { url });
        }
        throw new FetchFailedError(`Network error: ${err.message}`, { url, cause: err });
    }

    const status = response.status;
    const finalUrl = response.request?.res?.responseUrl || url;
    const contentType = response.headers?.["content-type"] || "";
    const html = typeof response.data === "string" ? response.data : "";

    if (html.length > maxBytes) {
        throw new FetchTooLargeError(`Response exceeded ${maxBytes} bytes`, { url });
    }

    if (status === 403 || status === 429) {
        throw new FetchBlockedError(`Blocked by origin (HTTP ${status})`, { status, url });
    }

    if (looksLikeChallenge(html)) {
        throw new FetchBlockedError("Cloudflare/anti-bot challenge page detected", { status, url });
    }

    if (status < 200 || status >= 300) {
        throw new FetchFailedError(`Non-2xx response (HTTP ${status})`, { status, url });
    }

    return { html, finalUrl, status, contentType };
}

module.exports = {
    fetchHtml,
    FetchBlockedError,
    FetchFailedError,
    FetchTooLargeError,
    FetchTimeoutError,
};
