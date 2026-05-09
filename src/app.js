const express = require("express");
const cors = require("cors");
const fileUpload = require("express-fileupload");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const config = require("./config");
const logger = require("./utils/logger");
const errorHandler = require("./middleware/errorHandler");

require("./config/firebase");

const jobsRoutes = require("./modules/jobs/jobs.routes");
const companiesRoutes = require("./modules/companies/companies.routes");
const analyticsRoutes = require("./modules/analytics/analytics.routes");
const scraperAdminRoutes = require("./modules/scraper/scraper.admin.routes");
const blogRoutes = require("./modules/blog/blog.routes");
const blogAdminRoutes = require("./modules/blog/blog.admin.routes");
const jobsV2AdminRoutes = require("./modules/jobsV2/jobsV2.admin.routes");
const companiesV2AdminRoutes = require("./modules/companiesV2/companiesV2.admin.routes");
const jobsV2PublicRoutes = require("./modules/jobsV2/jobsV2.public.routes");
const jobsV2PublicReadRoutes = require("./modules/jobsV2/jobsV2.publicRead.routes");
const companiesV2PublicReadRoutes = require("./modules/companiesV2/companiesV2.publicRead.routes");

const app = express();

// CAT-SEC-005: disable nested-object query parser; prevents `?x[$ne]=...` from
// becoming a Mongo operator object.
app.set("query parser", "simple");

// CAT-SEC-016: trust proxy hop count is configurable.
app.set("trust proxy", config.server.trustProxy);

const STATIC_PUBLIC_ORIGINS = [
    "https://careersat.tech",
    "https://www.careersat.tech",
    "http://localhost:3000",
];
const VERCEL_PREVIEW = /^https:\/\/[^/]+\.vercel\.app$/;
const allowedOrigins = Array.from(new Set([...STATIC_PUBLIC_ORIGINS, ...config.server.allowedOrigins]));

app.use(
    cors({
        origin: (origin, cb) => {
            if (!origin) return cb(null, true);
            if (allowedOrigins.includes(origin)) return cb(null, true);
            if (VERCEL_PREVIEW.test(origin)) return cb(null, true);
            return cb(null, false);
        },
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "x-api-key", "x-admin-secret"],
        credentials: true,
    })
);

// CAT-SEC-015: explicit Helmet configuration for an API server.
app.use(
    helmet({
        contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
        hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
        crossOriginResourcePolicy: { policy: "same-site" },
    })
);

const readLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later" },
});

const writeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later" },
});

const TRACK_PATH = /^\/jobs\/v2\/[^/]+\/track-(view|apply)$/;

app.use("/api", (req, res, next) => {
    if (req.method === "GET") return readLimiter(req, res, next);
    if (req.method === "POST" && TRACK_PATH.test(req.path)) return next();
    return writeLimiter(req, res, next);
});

app.use(
    fileUpload({
        useTempFiles: true,
        tempFileDir: "/tmp/",
        limits: { fileSize: 5 * 1024 * 1024 },
        abortOnLimit: true,
    })
);
app.use(express.json({ limit: "1mb" }));

app.use("/api", jobsRoutes);
app.use("/api", companiesRoutes);
app.use("/api", analyticsRoutes);
app.use("/api", scraperAdminRoutes);
app.use("/api", blogRoutes);
app.use("/api", blogAdminRoutes);
app.use("/api", jobsV2AdminRoutes);
app.use("/api", companiesV2AdminRoutes);
app.use("/api/jobs/v2", jobsV2PublicReadRoutes);
app.use("/api/companies/v2", companiesV2PublicReadRoutes);
app.use("/api", jobsV2PublicRoutes);

app.use(errorHandler);

module.exports = app;
module.exports.logger = logger;
