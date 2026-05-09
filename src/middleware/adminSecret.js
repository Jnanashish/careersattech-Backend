const config = require("../config");
const safeEqual = require("../utils/safeEqual");

function requireAdminSecret(req, res, next) {
    const provided = req.headers["x-admin-secret"];
    const expected = config.auth.adminSecret;
    if (!expected || !provided || !safeEqual(provided, expected)) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    next();
}

module.exports = requireAdminSecret;
