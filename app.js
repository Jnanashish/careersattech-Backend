const express = require("express");
const dotenv = require("dotenv");
const fileUpload = require("express-fileupload");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

dotenv.config();

const requiredEnvVars = ["DATABASE", "CLOUD_NAME", "API_KEY", "API_SECRET", "ADMIN_API_KEY"];
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

require("./DB/connection");

const jobdetailsRoutes = require("./routes/jobs.routes");
const companydetailsRoutes = require("./routes/company.routes");

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

const PORT = process.env.PORT || 5002;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});