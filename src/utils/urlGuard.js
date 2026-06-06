const dns = require("dns");
const net = require("net");
const http = require("http");
const https = require("https");

// ─────────────────────────────────────────────────────────────────────────
// SSRF guard.
//
// Two layers of defence for outbound fetches of attacker-influenced URLs
// (admin-pasted apply links, scraped career-page links, stored apply links the
// verifier re-checks):
//
//   1. A cheap hostname/IP-literal check (`isPublicHttp(s)Url`) that runs
//      before we ever open a socket. It canonicalises IPv4 given in decimal,
//      hex or octal, unwraps IPv4-mapped IPv6, and rejects loopback, private,
//      link-local (incl. 169.254.169.254 cloud metadata) and CGNAT ranges.
//   2. A DNS-resolving `lookup` on the HTTP agents (`guardedHttpAgent` /
//      `guardedHttpsAgent`) that re-checks the *resolved* IP at connect time —
//      for every redirect hop too. This is what stops DNS-rebinding, where a
//      public-looking hostname resolves to a private address.
//
// Layer 1 gives nice early errors and covers the common case; layer 2 is the
// actual security boundary. Always pass the guarded agents to axios when the
// target URL is not fully trusted.
// ─────────────────────────────────────────────────────────────────────────

const PRIVATE_HOSTNAMES = new Set([
    "localhost",
    "ip6-localhost",
    "ip6-loopback",
    "metadata",
    "metadata.google.internal",
]);

// Parse a single IPv4 component that may be decimal, 0x-prefixed hex, or
// 0-prefixed octal. Returns the numeric value or null if it isn't one of those.
function parseIpNumber(str) {
    if (typeof str !== "string" || str.length === 0) return null;
    let n;
    if (/^0x[0-9a-f]+$/i.test(str)) n = parseInt(str.slice(2), 16);
    else if (/^0[0-7]+$/.test(str)) n = parseInt(str, 8);
    else if (/^[0-9]+$/.test(str)) n = parseInt(str, 10);
    else return null;
    return Number.isInteger(n) ? n : null;
}

// Canonicalise an IPv4 host to plain dotted-decimal, following the same
// permissive `inet_aton` rules the OS resolver uses: 1–4 parts, each part
// decimal / 0x-hex / 0-octal, and a final part that fills all remaining bytes
// (so 2130706433, 0x7f000001, 0177.0.0.1, and 127.1 all collapse to 127.0.0.1).
// Returns null when the host is not an IPv4 literal — i.e. it's a real
// hostname (any part containing letters fails to parse).
function canonicalizeIpv4(host) {
    const parts = host.split(".");
    if (parts.length === 0 || parts.length > 4) return null;
    const nums = parts.map(parseIpNumber);
    if (nums.some((n) => n === null || n < 0)) return null;

    const leading = nums.slice(0, -1);
    const last = nums[nums.length - 1];
    if (leading.some((n) => n > 255)) return null;

    const remainingBytes = 4 - leading.length;
    if (last > Math.pow(256, remainingBytes) - 1) return null;

    let value = 0;
    for (const n of leading) value = value * 256 + n;
    value = value * Math.pow(256, remainingBytes) + last;
    if (value < 0 || value > 0xffffffff) return null;

    return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
}

function isPrivateIpv4(dotted) {
    const [a, b] = dotted.split(".").map(Number);
    if (a === 0) return true; // 0.0.0.0/8 "this network"
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
    return false;
}

function isPrivateIpv6(host) {
    const h = host.toLowerCase();
    if (h === "::1" || h === "::") return true; // loopback / unspecified
    if (h.startsWith("fe80:")) return true; // link-local
    if (/^f[cd][0-9a-f]{2}:/.test(h)) return true; // fc00::/7 unique-local
    // IPv4-mapped / -compatible (e.g. ::ffff:127.0.0.1) — unwrap and re-check.
    const m = h.match(/(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/);
    if (m) {
        const v4 = canonicalizeIpv4(m[1]);
        if (v4 && isPrivateIpv4(v4)) return true;
    }
    return false;
}

// True for any host we must never connect to: loopback, RFC1918, link-local,
// CGNAT, multicast/reserved, and internal-only TLDs. Hostnames that aren't IP
// literals and don't match the reserved suffixes are treated as public here —
// the resolved-IP check on the agent is what guards those.
function isPrivateHost(hostname) {
    if (!hostname) return true;
    const host = String(hostname).toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (!host) return true;
    if (PRIVATE_HOSTNAMES.has(host)) return true;
    if (host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
        return true;
    }
    if (net.isIPv6(host) || host.includes(":")) return isPrivateIpv6(host);
    const v4 = canonicalizeIpv4(host);
    if (v4) return isPrivateIpv4(v4);
    return false;
}

// True for a literal IP (after Node has resolved a hostname) that is private.
function isPrivateIp(ip) {
    if (net.isIPv6(ip)) return isPrivateIpv6(ip);
    if (net.isIPv4(ip)) return isPrivateIpv4(ip);
    return true; // unknown form → treat as unsafe
}

function isPublicUrlForSchemes(input, schemes) {
    let url;
    try {
        url = new URL(input);
    } catch {
        return false;
    }
    if (!schemes.includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!host) return false;
    return !isPrivateHost(host);
}

function isPublicHttpsUrl(input) {
    return isPublicUrlForSchemes(input, ["https:"]);
}

function isPublicHttpUrl(input) {
    return isPublicUrlForSchemes(input, ["http:", "https:"]);
}

function assertPublicHttpsUrl(input) {
    if (!isPublicHttpsUrl(input)) {
        const err = new Error("URL is not a public HTTPS endpoint");
        err.status = 400;
        throw err;
    }
}

function assertPublicHttpUrl(input) {
    if (!isPublicHttpUrl(input)) {
        const err = new Error("URL is not a public HTTP(S) endpoint");
        err.status = 400;
        throw err;
    }
}

function blockedError(hostname, address) {
    const err = new Error(
        address
            ? `Blocked SSRF: ${hostname} resolves to private address ${address}`
            : `Blocked SSRF: ${hostname} is a private host`
    );
    err.code = "SSRF_BLOCKED";
    return err;
}

// DNS lookup that refuses to hand back a private address. Used as the `lookup`
// option on the guarded agents so every connection (including redirect hops)
// is validated against the address actually being dialled.
function guardedLookup(hostname, options, callback) {
    // `options` may be a callback when called as lookup(host, cb).
    if (typeof options === "function") {
        callback = options;
        options = {};
    }
    if (isPrivateHost(hostname)) {
        return callback(blockedError(hostname));
    }
    dns.lookup(hostname, options, (err, address, family) => {
        if (err) return callback(err);
        if (isPrivateIp(address)) return callback(blockedError(hostname, address));
        return callback(null, address, family);
    });
}

const guardedHttpAgent = new http.Agent({ lookup: guardedLookup });
const guardedHttpsAgent = new https.Agent({ lookup: guardedLookup });

// Drop-in axios config fragment: { httpAgent, httpsAgent } that block private
// targets at connect time. Spread into an axios request config.
const guardedAxiosAgents = { httpAgent: guardedHttpAgent, httpsAgent: guardedHttpsAgent };

module.exports = {
    isPublicHttpsUrl,
    isPublicHttpUrl,
    assertPublicHttpsUrl,
    assertPublicHttpUrl,
    isPrivateHost,
    isPrivateIp,
    guardedLookup,
    guardedHttpAgent,
    guardedHttpsAgent,
    guardedAxiosAgents,
};
