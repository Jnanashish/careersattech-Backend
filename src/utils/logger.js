const { createLogger, format, transports } = require("winston");

const REDACT_KEYS = new Set([
    "authorization",
    "x-api-key",
    "x-admin-secret",
    "password",
    "token",
    "api_key",
    "apiKey",
    "private_key",
    "privateKey",
]);

const redact = format((info) => {
    function walk(obj) {
        if (obj && typeof obj === "object") {
            for (const k of Object.keys(obj)) {
                if (REDACT_KEYS.has(k.toLowerCase())) {
                    obj[k] = "[REDACTED]";
                } else if (typeof obj[k] === "object") {
                    walk(obj[k]);
                }
            }
        }
    }
    walk(info);
    return info;
});

const isProd = process.env.NODE_ENV === "production";

const logger = createLogger({
    level: process.env.LOG_LEVEL || (isProd ? "info" : "debug"),
    format: format.combine(
        redact(),
        format.timestamp(),
        isProd ? format.json() : format.combine(format.colorize(), format.simple())
    ),
    transports: [new transports.Console()],
});

module.exports = logger;
