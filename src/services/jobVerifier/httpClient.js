const axios = require("axios");

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 5;

const DEFAULT_HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
};

/**
 * Fetch a URL with browser-like headers and return a normalized shape.
 *
 * Never throws on HTTP status (we need the status code to classify).
 * Errors (timeout, DNS, TLS, refused) are surfaced via the `error` field.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.maxRedirects]
 * @returns {Promise<{ statusCode: number|null, finalUrl: string|null, body: string, error: { type: string, message: string }|null }>}
 */
async function fetchUrl(url, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

    try {
        const res = await axios.get(url, {
            timeout: timeoutMs,
            maxRedirects,
            validateStatus: () => true,
            headers: DEFAULT_HEADERS,
            responseType: "text",
            // Accept all status codes; we want the body even on 404.
            transformResponse: [(d) => (typeof d === "string" ? d : String(d ?? ""))],
        });

        const finalUrl =
            res.request?.res?.responseUrl ||
            res.request?.responseURL ||
            (res.config && res.config.url) ||
            url;

        return {
            statusCode: res.status,
            finalUrl,
            body: typeof res.data === "string" ? res.data : "",
            error: null,
        };
    } catch (err) {
        return {
            statusCode: null,
            finalUrl: null,
            body: "",
            error: classifyError(err),
        };
    }
}

function classifyError(err) {
    if (!err) return { type: "unknown", message: "unknown error" };
    const code = err.code || "";
    if (code === "ECONNABORTED" || /timeout/i.test(err.message || "")) {
        return { type: "timeout", message: err.message };
    }
    if (code === "ENOTFOUND") return { type: "dns", message: err.message };
    if (code === "ECONNREFUSED") return { type: "refused", message: err.message };
    if (code === "ECONNRESET") return { type: "reset", message: err.message };
    if (/^ERR_TLS|^CERT_|EPROTO|SELF_SIGNED/i.test(code)) {
        return { type: "tls", message: err.message };
    }
    if (/maxRedirects/i.test(err.message || "")) {
        return { type: "too-many-redirects", message: err.message };
    }
    return { type: code || "network", message: err.message || String(err) };
}

module.exports = { fetchUrl };
