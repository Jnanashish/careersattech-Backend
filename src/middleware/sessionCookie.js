const crypto = require("crypto");
const cookie = require("cookie");
const { nanoid } = require("nanoid");
const config = require("../config");

const PEPPER = config.security.clickHashPepper;
if (!PEPPER) {
    throw new Error("FATAL: CLICK_HASH_PEPPER environment variable is not set");
}

const COOKIE_NAME = "cat_sess";
const SESSION_ID_LENGTH = 21;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function hashIp(ip) {
    return crypto.createHmac("sha256", PEPPER).update(String(ip || "")).digest("hex");
}

function sessionCookie(req, res, next) {
    const cookies = req.headers.cookie ? cookie.parse(req.headers.cookie) : {};
    let sessionId = cookies[COOKIE_NAME];

    if (!sessionId) {
        sessionId = nanoid(SESSION_ID_LENGTH);
        res.cookie(COOKIE_NAME, sessionId, {
            maxAge: MAX_AGE_MS,
            httpOnly: true,
            sameSite: "lax",
            secure: config.server.isProd,
            path: "/",
        });
    }

    req.sessionHash = sessionId;
    req.ipHash = hashIp(req.ip);
    next();
}

module.exports = sessionCookie;
module.exports.hashIp = hashIp;
