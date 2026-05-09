const PRIVATE_HOST_RE = /^(127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0$|localhost$|metadata\.google\.internal$)/i;
const RFC1918_172_RE = /^172\.(1[6-9]|2\d|3[0-1])\./;
const IPV6_LOCAL_RE = /^(::1|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:|fe80:)/i;

function isPublicHttpsUrl(input) {
    let url;
    try {
        url = new URL(input);
    } catch {
        return false;
    }
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (!host) return false;
    if (PRIVATE_HOST_RE.test(host)) return false;
    if (RFC1918_172_RE.test(host)) return false;
    if (IPV6_LOCAL_RE.test(host)) return false;
    return true;
}

function assertPublicHttpsUrl(input) {
    if (!isPublicHttpsUrl(input)) {
        const err = new Error("URL is not a public HTTPS endpoint");
        err.status = 400;
        throw err;
    }
}

module.exports = { isPublicHttpsUrl, assertPublicHttpsUrl };
