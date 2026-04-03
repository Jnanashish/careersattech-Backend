const express = require("express");
const fileUpload = require("express-fileupload");

function createApp() {
    const app = express();

    app.use(
        fileUpload({
            useTempFiles: true,
            tempFileDir: "/tmp/",
            limits: { fileSize: 5 * 1024 * 1024 },
            abortOnLimit: true,
        })
    );
    app.use(express.json({ limit: "1mb" }));

    const jobdetailsRoutes = require("../routes/jobs.routes");
    const companydetailsRoutes = require("../routes/company.routes");

    app.use("/api", jobdetailsRoutes);
    app.use("/api", companydetailsRoutes);

    return app;
}

module.exports = createApp;
