const logger = require("../utils/logger");
const { ZodError } = require("zod");

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
    if (err instanceof ZodError) {
        return res.status(400).json({ error: "Validation failed", details: err.flatten() });
    }
    if (err && err.name === "ValidationError") {
        return res.status(400).json({ error: err.message });
    }
    if (err && err.name === "CastError") {
        return res.status(400).json({ error: "Invalid id" });
    }
    if (err && err.code === 11000) {
        return res.status(409).json({ error: "Resource already exists" });
    }
    if (err && err.status && Number.isInteger(err.status)) {
        return res.status(err.status).json({ error: err.message || "Request failed" });
    }
    logger.error(`Unhandled error on ${req.method} ${req.originalUrl}: ${err && err.stack ? err.stack : err}`);
    return res.status(500).json({ error: "Internal server error" });
}

module.exports = errorHandler;
