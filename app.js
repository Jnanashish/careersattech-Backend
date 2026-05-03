const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const fileUpload = require("express-fileupload");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

dotenv.config();

const requiredEnvVars = ["DATABASE", "CLOUD_NAME", "API_KEY", "API_SECRET", "FIREBASE_PROJECT_ID", "FIREBASE_PRIVATE_KEY", "FIREBASE_CLIENT_EMAIL"];
for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        console.error(`FATAL: Missing required environment variable: ${envVar}`);
        process.exit(1);
    }
}

if (!process.env.ALLOWED_ORIGINS) {
    console.warn("WARNING: ALLOWED_ORIGINS not set — CORS will only allow localhost:3000");
}

const app = express();
app.set("trust proxy", 1);

require("./config/firebase");
require("./DB/connection");

const jobdetailsRoutes = require("./routes/jobs.routes");
const companydetailsRoutes = require("./routes/company.routes");
const analyticsRoutes = require("./routes/analytics.routes");
const scraperAdminRoutes = require("./scraper/admin.routes");
const scheduler = require("./scraper/scheduler");
const blogRoutes = require("./blog/blog.routes");
const blogAdminRoutes = require("./blog/blog.admin.routes");
const blogScheduler = require("./blog/blog.scheduler");
const jobsV2AdminRoutes = require("./routes/admin/jobsV2.routes");
const companiesV2AdminRoutes = require("./routes/admin/companiesV2.routes");
const jobsV2PublicRoutes = require("./routes/public/jobsV2.routes");
const jobsV2PublicReadRoutes = require("./routes/public/jobsV2Public.routes");
const companiesV2PublicReadRoutes = require("./routes/public/companiesV2Public.routes");

const STATIC_PUBLIC_ORIGINS = [
    "https://careersat.tech",
    "https://www.careersat.tech",
    "http://localhost:3000",
];
const VERCEL_PREVIEW = /^https:\/\/[^/]+\.vercel\.app$/;

const envOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

const allowedOrigins = Array.from(new Set([...STATIC_PUBLIC_ORIGINS, ...envOrigins]));

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

app.use(helmet());

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

// Track endpoints have their own per-IP+slug limiter (10/min, silent 204).
// Skip the global write limiter so they aren't blocked with a 429 JSON body.
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
        limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
        abortOnLimit: true,
    })
);
app.use(express.json({ limit: "1mb" }));

app.use("/api", jobdetailsRoutes);
app.use("/api", companydetailsRoutes);
app.use("/api", analyticsRoutes);
app.use("/api", scraperAdminRoutes);
app.use("/api", blogRoutes);
app.use("/api", blogAdminRoutes);
app.use("/api", jobsV2AdminRoutes);
app.use("/api", companiesV2AdminRoutes);
app.use("/api/jobs/v2", jobsV2PublicReadRoutes);
app.use("/api/companies/v2", companiesV2PublicReadRoutes);
app.use("/api", jobsV2PublicRoutes);

const PORT = process.env.PORT || 5002;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    scheduler.init();
    blogScheduler.init();
});