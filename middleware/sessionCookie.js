const crypto = require("crypto");
const { nanoid } = require("nanoid");

const PEPPER = process.env.CLICK_HASH_PEPPER;
if (!PEPPER) {
    throw new Error("FATAL: CLICK_HASH_PEPPER environment variable is not set");
}

const COOKIE_NAME = "cat_sess";
const SESSION_ID_LENGTH = 21;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function parseCookieHeader(header) {
    if (!header) return {};
    const out = {};
    for (const part of header.split(";")) {
        const idx = part.indexOf("=");
        if (idx === -1) continue;
        const key = part.slice(0, idx).trim();
        const val = part.slice(idx + 1).trim();
        if (key && !(key in out)) out[key] = decodeURIComponent(val);
    }
    return out;
}

function hashIp(ip) {
    return crypto.createHash("sha256").update(String(ip || "") + PEPPER).digest("hex");
}

function sessionCookie(req, res, next) {
    const cookies = parseCookieHeader(req.headers.cookie);
    let sessionId = cookies[COOKIE_NAME];

    if (!sessionId) {
        sessionId = nanoid(SESSION_ID_LENGTH);
        res.cookie(COOKIE_NAME, sessionId, {
            maxAge: MAX_AGE_MS,
            httpOnly: false,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            path: "/",
        });
    }

    req.sessionHash = sessionId;
    req.ipHash = hashIp(req.ip);
    next();
}

module.exports = sessionCookie;
module.exports.hashIp = hashIp;
