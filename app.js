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

const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",")
    : ["http://localhost:3000"];

app.use(
    cors({
        origin: allowedOrigins,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        allowedHeaders: ["Content-Type", "Authorization", "x-api-key", "x-admin-secret"],
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

app.use("/api", (req, res, next) => {
    if (req.method === "GET") return readLimiter(req, res, next);
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
app.use("/api", jobsV2PublicRoutes);

const PORT = process.env.PORT || 5002;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    scheduler.init();
    blogScheduler.init();
});