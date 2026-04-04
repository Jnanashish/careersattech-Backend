const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const StagingJob = require("./models/StagingJob");
const ScrapeLog = require("./models/ScrapeLog");
const Jobdesc = require("../model/jobs.schema");
const { runPipeline } = require("./scheduler");
const { scrapeOne, getAdapterByName } = require("./scraper");

// Auth middleware — checks x-admin-secret header
function requireAdminSecret(req, res, next) {
    const secret = req.headers["x-admin-secret"];
    if (!secret || secret !== process.env.ADMIN_SECRET) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    next();
}

router.use(requireAdminSecret);

// POST /admin/scrape/run — trigger manual scrape
router.post("/admin/scrape/run", async (req, res) => {
    try {
        // Run async, return immediately
        res.json({ message: "Scrape run started", status: "running" });
        runPipeline("manual").catch((err) => {
            console.error(`[Admin] Manual scrape run failed: ${err.message}`);
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// GET /admin/scrape/staging — list staging jobs
router.get("/admin/scrape/staging", async (req, res) => {
    try {
        const { status, page = 1, size = 20, source } = req.query;
        const filter = {};
        if (status) filter.status = status;
        if (source) filter.source = source;

        const limit = Math.min(Math.max(parseInt(size) || 20, 1), 100);
        const pageNum = Math.max(parseInt(page) || 1, 1);
        const skip = (pageNum - 1) * limit;

        const [jobs, total] = await Promise.all([
            StagingJob.find(filter).sort({ scrapedAt: -1 }).skip(skip).limit(limit),
            StagingJob.countDocuments(filter),
        ]);

        res.json({ data: jobs, totalCount: total, page: pageNum, size: limit });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// GET /admin/scrape/staging/:id — get single staging job
router.get("/admin/scrape/staging/:id", async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: "Invalid ID" });
        }
        const job = await StagingJob.findById(req.params.id);
        if (!job) return res.status(404).json({ error: "Not found" });
        res.json({ data: job });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// POST /admin/scrape/staging/:id/approve — approve and copy to main collection
router.post("/admin/scrape/staging/:id/approve", async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: "Invalid ID" });
        }
        const staging = await StagingJob.findById(req.params.id);
        if (!staging) return res.status(404).json({ error: "Not found" });
        if (staging.status !== "pending") {
            return res.status(400).json({ error: `Job already ${staging.status}` });
        }

        // Allow overrides from request body
        const jobData = { ...staging.jobData.toObject(), ...req.body.overrides };

        const newJob = new Jobdesc(jobData);
        await newJob.save();

        staging.status = "approved";
        staging.approvedAt = new Date();
        await staging.save();

        res.json({ message: "Approved", data: newJob });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// POST /admin/scrape/staging/:id/reject — reject with reason
router.post("/admin/scrape/staging/:id/reject", async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: "Invalid ID" });
        }
        const staging = await StagingJob.findById(req.params.id);
        if (!staging) return res.status(404).json({ error: "Not found" });
        if (staging.status !== "pending") {
            return res.status(400).json({ error: `Job already ${staging.status}` });
        }

        staging.status = "rejected";
        staging.rejectedReason = req.body.reason || "";
        await staging.save();

        res.json({ message: "Rejected" });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// POST /admin/scrape/staging/approve-bulk — approve multiple
router.post("/admin/scrape/staging/approve-bulk", async (req, res) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: "ids array required" });
        }

        let approved = 0;
        let failed = 0;
        const errors = [];

        for (const id of ids) {
            try {
                if (!mongoose.Types.ObjectId.isValid(id)) {
                    errors.push({ id, error: "Invalid ID" });
                    failed++;
                    continue;
                }

                const staging = await StagingJob.findById(id);
                if (!staging || staging.status !== "pending") {
                    errors.push({ id, error: staging ? `Already ${staging.status}` : "Not found" });
                    failed++;
                    continue;
                }

                const newJob = new Jobdesc(staging.jobData.toObject());
                await newJob.save();

                staging.status = "approved";
                staging.approvedAt = new Date();
                await staging.save();

                approved++;
            } catch (err) {
                errors.push({ id, error: err.message });
                failed++;
            }
        }

        res.json({ approved, failed, errors });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// DELETE /admin/scrape/staging/:id — delete staging job
router.delete("/admin/scrape/staging/:id", async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: "Invalid ID" });
        }
        const deleted = await StagingJob.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ error: "Not found" });
        res.json({ message: "Deleted" });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// GET /admin/scrape/logs — list recent scrape logs
router.get("/admin/scrape/logs", async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const logs = await ScrapeLog.find({}).sort({ startedAt: -1 }).limit(limit);
        res.json({ data: logs });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// GET /admin/scrape/health — adapter health from latest logs
router.get("/admin/scrape/health", async (req, res) => {
    try {
        const latestLog = await ScrapeLog.findOne({}).sort({ startedAt: -1 });
        if (!latestLog) {
            return res.json({ message: "No scrape runs yet", adapters: [] });
        }

        const health = latestLog.adapters.map((a) => ({
            name: a.name,
            status: a.status,
            jobsIngested: a.jobsIngested,
            errorCount: a.errors.length,
            lastRun: latestLog.startedAt,
        }));

        res.json({ data: health, lastRunId: latestLog.runId });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// POST /admin/scrape/test-adapter/:name — test adapter without saving
router.post("/admin/scrape/test-adapter/:name", async (req, res) => {
    try {
        const adapter = getAdapterByName(req.params.name);
        if (!adapter) {
            return res.status(404).json({ error: `Adapter "${req.params.name}" not found` });
        }

        const { jobs, stats } = await scrapeOne(adapter, { limit: 3 });

        res.json({
            adapter: adapter.name,
            linksFound: stats.jobLinksFound,
            jobs: jobs.map((j) => ({
                title: j.meta.title,
                company: j.meta.company,
                companyUrl: j.companyPageUrl,
                rawContentSnippet: j.pageContent?.slice(0, 500),
            })),
            errors: stats.errors,
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

module.exports = router;
