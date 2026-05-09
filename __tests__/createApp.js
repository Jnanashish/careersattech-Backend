const express = require("express");
const fileUpload = require("express-fileupload");

/**
 * Test harness app builder. Mounts every router the public app uses, with
 * the same middleware order. Defaults to mounting all routers; pass
 * { only: [...] } to limit to a subset for narrower tests.
 */
function createApp(opts = {}) {
    const app = express();

    app.set("trust proxy", 1);

    app.use(
        fileUpload({
            useTempFiles: true,
            tempFileDir: "/tmp/",
            limits: { fileSize: 5 * 1024 * 1024 },
            abortOnLimit: true,
        })
    );
    app.use(express.json({ limit: "1mb" }));

    const all = !opts.only;
    const enabled = (name) => all || opts.only.includes(name);

    if (enabled("jobsV1")) {
        app.use("/api", require("../routes/jobs.routes"));
    }
    if (enabled("companiesV1")) {
        app.use("/api", require("../routes/company.routes"));
    }
    if (enabled("analytics")) {
        app.use("/api", require("../routes/analytics.routes"));
    }
    if (enabled("jobsV2Admin")) {
        app.use("/api", require("../routes/admin/jobsV2.routes"));
    }
    if (enabled("companiesV2Admin")) {
        app.use("/api", require("../routes/admin/companiesV2.routes"));
    }
    if (enabled("jobsV2Public")) {
        app.use("/api", require("../routes/public/jobsV2.routes"));
    }
    if (enabled("blogPublic")) {
        app.use("/api", require("../blog/blog.routes"));
    }
    if (enabled("blogAdmin")) {
        app.use("/api", require("../blog/blog.admin.routes"));
    }
    if (enabled("scraperAdmin")) {
        app.use("/api", require("../scraper/admin.routes"));
    }

    return app;
}

module.exports = createApp;
