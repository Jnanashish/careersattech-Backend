const crypto = require("crypto");

function safeEqual(a, b) {
    if (typeof a !== "string" || typeof b !== "string") return false;
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    try {
        return crypto.timingSafeEqual(ab, bb);
    } catch {
        return false;
    }
}

module.exports = safeEqual;
