const admin = require("../config/firebase");

const requireAuth = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    // Try Firebase token first
    if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.slice(7);
        try {
            const decoded = await admin.auth().verifyIdToken(token);
            req.firebaseUser = {
                uid: decoded.uid,
                email: decoded.email,
                emailVerified: decoded.email_verified,
            };
            return next();
        } catch (err) {
            // If it looks like a Firebase token (long JWT), reject immediately
            if (token.length > 100) {
                console.error("Firebase token verification failed:", err.code || err.message);
                return res.status(401).json({ error: "Invalid or expired token" });
            }
            // Short token — fall through to legacy API key check
        }
    }

    // Legacy fallback: x-api-key header or short Bearer token
    const apiKey =
        req.headers["x-api-key"] ||
        (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);

    if (apiKey && apiKey === process.env.ADMIN_API_KEY) {
        console.warn("DEPRECATED: Legacy x-api-key auth used on", req.method, req.url);
        req.firebaseUser = { uid: "legacy-api-key", email: "admin@internal" };
        return next();
    }

    return res.status(401).json({ error: "Unauthorized" });
};

module.exports = requireAuth;
