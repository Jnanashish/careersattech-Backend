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

require("./config/firebase");
require("./DB/connection");

const jobdetailsRoutes = require("./routes/jobs.routes");
const companydetailsRoutes = require("./routes/company.routes");
const scraperAdminRoutes = require("./scraper/admin.routes");
const scheduler = require("./scraper/scheduler");

const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",")
    : ["http://localhost:3000"];

app.use(
    cors({
        origin: allowedOrigins,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        allowedHeaders: ["Content-Type", "Authorization", "x-api-key"],
    })
);

app.use(helmet());

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later" },
});
app.use("/api", limiter);

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
app.use("/api", scraperAdminRoutes);

const PORT = process.env.PORT || 5002;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    scheduler.init();
});