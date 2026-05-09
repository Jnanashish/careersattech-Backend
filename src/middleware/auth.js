const admin = require("../config/firebase");
const config = require("../config");
const safeEqual = require("../utils/safeEqual");
const logger = require("../utils/logger");

async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.slice(7);
        try {
            const decoded = await admin.auth().verifyIdToken(token);
            if (decoded.email_verified !== true) {
                return res.status(403).json({ error: "Email not verified" });
            }
            if (config.firebase.requireAdminClaim && decoded.admin !== true) {
                return res.status(403).json({ error: "Admin claim required" });
            }
            req.firebaseUser = {
                uid: decoded.uid,
                email: decoded.email,
                emailVerified: decoded.email_verified,
                admin: decoded.admin === true,
            };
            return next();
        } catch (err) {
            // Firebase verification failed; allow legacy fallback only when explicitly enabled.
            if (!config.auth.adminApiKey) {
                logger.warn(`Firebase token verification failed: ${err.code || err.message}`);
                return res.status(401).json({ error: "Invalid or expired token" });
            }
            // fall through to legacy api key check
        }
    }

    if (config.auth.adminApiKey) {
        const apiKey = req.headers["x-api-key"];
        if (apiKey && safeEqual(apiKey, config.auth.adminApiKey)) {
            logger.warn(`DEPRECATED: Legacy x-api-key auth used on ${req.method} ${req.url}`);
            req.firebaseUser = { uid: "legacy-api-key", email: "admin@internal", admin: true };
            return next();
        }
    }

    return res.status(401).json({ error: "Unauthorized" });
}

module.exports = requireAuth;
