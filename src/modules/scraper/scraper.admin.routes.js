const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const StagingJob = require("./models/stagingJob.model");
const ScrapeLog = require("./models/scrapeLog.model");
const { runPipeline } = require("../../jobs/scraper.scheduler");
const { scrapeOne, getAdapterByName, listAllAdapters } = require("./scraper.fetch");
const {
    approveStagingJob,
    isDuplicateKeyError,
    duplicateKeyMessage,
    publishPendingBacklog,
} = require("./publisher");
const { requestStop, clearStop, getAll: getStopFlags } = require("./stopFlags");
const requireAdminSecret = require("../../middleware/adminSecret");
const asyncHandler = require("../../middleware/asyncHandler");
const logger = require("../../utils/logger");

// CAT-SEC-004: allowlist of fields admins may override at approve time.
const ALLOWED_OVERRIDE_FIELDS = new Set([
    "title",
    "salary",
    "salaryRange",
    "skilltags",
    "tags",
    "location",
    "category",
    "expiresAt",
    "isActive",
]);

function pickAllowedOverrides(input) {
    if (!input || typeof input !== "object") return {};
    const out = {};
    for (const [k, v] of Object.entries(input)) {
        if (ALLOWED_OVERRIDE_FIELDS.has(k)) out[k] = v;
    }
    return out;
}

router.use("/admin/scrape", requireAdminSecret);

// The publish routine (approveStagingJob) and its E11000 helpers live in
// ./publisher so the scraper scheduler can reuse them for the auto-publish
// bypass without importing this Express router (which would be circular —
// the router already imports runPipeline from the scheduler).

/**
 * Best-effort admin identity for audit stamping. The scraper admin routes
 * authenticate via x-admin-secret only (no Firebase user), so we accept the
 * acting admin id from a body field or header and fall back to a sentinel.
 */
function resolveApprovedBy(req, bodyApprovedBy) {
    return (
        bodyApprovedBy ||
        req.body?.approvedBy ||
        req.headers["x-admin-user"] ||
        req.firebaseUser?.uid ||
        "admin"
    );
}

// POST /admin/scrape/run — trigger manual scrape.
// Body: { adapter?: string } — when provided, runs only that adapter
// (allowing disabled-by-default adapters like "peerlist" to be triggered
// from the UI). When omitted, runs the default enabled registry.
// Body: { autoPublish?: boolean } — per-run override of the auto-publish
// default (ON unless SCRAPER_AUTO_PUBLISH=false). true → publish scraped jobs
// straight to JobV2 (skip the staging review queue); false → force human review
// for this run. Omitted → use the default.
router.post("/admin/scrape/run", async (req, res, next) => {
    try {
        const adapterName = req.body && typeof req.body.adapter === "string"
            ? req.body.adapter.trim()
            : "";

        const autoPublish = req.body && typeof req.body.autoPublish === "boolean"
            ? req.body.autoPublish
            : undefined;

        let adapterList;
        if (adapterName) {
            const adapter = getAdapterByName(adapterName);
            if (!adapter) {
                return res.status(404).json({ error: `Adapter "${adapterName}" not found` });
            }
            // Clear any stale stop flag so the manual run is not aborted
            // immediately by a previously-pressed stop button.
            clearStop(adapterName);
            adapterList = [adapter];
        }

        res.json({
            message: "Scrape run started",
            status: "running",
            adapter: adapterName || "all",
            autoPublish: autoPublish === undefined ? "env-default" : autoPublish,
        });
        runPipeline("manual", adapterList, { autoPublish }).catch((err) => {
            logger.error(`[Admin] Manual scrape run failed: ${err.message}`);
        });
    } catch (err) {
        return next(err);
    }
});

// GET /admin/scrape/staging — list staging jobs
router.get("/admin/scrape/staging", async (req, res, next) => {
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
        return next(err);
    }
});

// GET /admin/scrape/staging/:id — get single staging job
router.get("/admin/scrape/staging/:id", async (req, res, next) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: "Invalid ID" });
        }
        const job = await StagingJob.findById(req.params.id);
        if (!job) return res.status(404).json({ error: "Not found" });
        res.json({ data: job });
    } catch (err) {
        return next(err);
    }
});

// POST /admin/scrape/staging/:id/approve — approve, ensure company, create JobV2
router.post("/admin/scrape/staging/:id/approve", async (req, res, next) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: "Invalid ID" });
        }
        const staging = await StagingJob.findById(req.params.id);
        if (!staging) return res.status(404).json({ error: "Not found" });
        if (staging.status !== "pending") {
            return res.status(400).json({ error: `Job already ${staging.status}` });
        }

        // CAT-SEC-004: only allow a fixed list of override fields.
        const overrides = pickAllowedOverrides(req.body?.overrides);
        const approvedBy = resolveApprovedBy(req);

        const result = await approveStagingJob(staging, overrides, approvedBy);

        if (result.fieldErrors) {
            return res.status(400).json({
                error: "Validation failed",
                details: result.fieldErrors,
            });
        }

        res.json({ message: "Approved", data: result.job });
    } catch (err) {
        if (isDuplicateKeyError(err)) {
            logger.error(`[Admin] Approve duplicate key: ${err.message}`);
            return res.status(409).json({
                error: duplicateKeyMessage(err),
                keyPattern: err.keyPattern,
                keyValue: err.keyValue,
            });
        }
        logger.error(`[Admin] Approve failed: ${err.message}`);
        return next(err);
    }
});

// POST /admin/scrape/staging/:id/reject — reject with reason
router.post("/admin/scrape/staging/:id/reject", async (req, res, next) => {
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
        return next(err);
    }
});

// POST /admin/scrape/staging/approve-bulk — approve multiple
router.post("/admin/scrape/staging/approve-bulk", async (req, res, next) => {
    try {
        const { ids, perJobOverrides = {} } = req.body || {};
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: "ids array required" });
        }

        const approvedBy = resolveApprovedBy(req);

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

                const overrides = pickAllowedOverrides(perJobOverrides[id]);
                const result = await approveStagingJob(staging, overrides, approvedBy);

                if (result.fieldErrors) {
                    errors.push({
                        id,
                        error: "Validation failed",
                        details: result.fieldErrors,
                    });
                    failed++;
                    continue;
                }

                approved++;
            } catch (err) {
                if (isDuplicateKeyError(err)) {
                    errors.push({
                        id,
                        error: duplicateKeyMessage(err),
                        keyPattern: err.keyPattern,
                        keyValue: err.keyValue,
                    });
                } else {
                    errors.push({ id, error: err.message });
                }
                failed++;
            }
        }

        res.json({ approved, failed, errors });
    } catch (err) {
        return next(err);
    }
});

// POST /admin/scrape/staging/publish-pending — drain the pending backlog now.
// Same routine the pipeline runs after each scrape; exposed so a backlog can be
// cleared without waiting for the next cron. Body:
//   { limit?: number (1–500, default 100), source?: string (single adapter),
//     retryExhausted?: boolean — also retry rows that already failed
//     MAX_AUTO_PUBLISH_ATTEMPTS times }
// Rows that fail the publish-readiness gate stay pending for manual review.
router.post("/admin/scrape/staging/publish-pending", async (req, res, next) => {
    try {
        const { limit, source, retryExhausted } = req.body || {};

        const result = await publishPendingBacklog({
            limit,
            source: typeof source === "string" && source.trim() ? source.trim() : undefined,
            retryExhausted: retryExhausted === true,
            approvedBy: resolveApprovedBy(req),
        });

        logger.info(
            `[Admin] Backlog drain: published ${result.published}/${result.scanned} ` +
            `(${result.failed} still pending)`
        );
        res.json(result);
    } catch (err) {
        logger.error(`[Admin] Backlog drain failed: ${err.message}`);
        return next(err);
    }
});

// DELETE /admin/scrape/staging/:id — delete staging job
router.delete("/admin/scrape/staging/:id", async (req, res, next) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: "Invalid ID" });
        }
        const deleted = await StagingJob.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ error: "Not found" });
        res.json({ message: "Deleted" });
    } catch (err) {
        return next(err);
    }
});

// GET /admin/scrape/logs — list recent scrape logs
router.get("/admin/scrape/logs", async (req, res, next) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const logs = await ScrapeLog.find({}).sort({ startedAt: -1 }).limit(limit);
        res.json({ data: logs });
    } catch (err) {
        return next(err);
    }
});

// GET /admin/scrape/health — adapter health.
// Enumerates every adapter file (including disabled ones such as peerlist
// that run on their own cron) and returns the latest log entry per adapter.
// Adapters that have never run yet appear with status "idle" so the admin
// UI always renders one card per known adapter.
router.get("/admin/scrape/health", async (req, res, next) => {
    try {
        const knownAdapters = listAllAdapters();
        const latestLog = await ScrapeLog.findOne({}).sort({ startedAt: -1 });

        const health = await Promise.all(
            knownAdapters.map(async (a) => {
                const base = {
                    name: a.name,
                    displayName: a.displayName || a.name,
                    enabled: a.enabled !== false,
                    manualOnly: a.enabled === false,
                };
                const lastForAdapter = await ScrapeLog.findOne({ "adapters.name": a.name })
                    .sort({ startedAt: -1 })
                    .lean();
                if (!lastForAdapter) {
                    return {
                        ...base,
                        status: "idle",
                        jobsIngested: 0,
                        errorCount: 0,
                        lastRun: null,
                    };
                }
                const entry = lastForAdapter.adapters.find((x) => x.name === a.name);
                return {
                    ...base,
                    status: entry.status,
                    jobsIngested: entry.jobsIngested || 0,
                    errorCount: (entry.errors || []).length,
                    lastRun: lastForAdapter.startedAt,
                };
            })
        );

        res.json({
            data: health,
            lastRunId: latestLog ? latestLog.runId : null,
            activeStopRequests: getStopFlags(),
        });
    } catch (err) {
        return next(err);
    }
});

// POST /admin/scrape/test-adapter/:name — test adapter without saving
router.post("/admin/scrape/test-adapter/:name", async (req, res, next) => {
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
        return next(err);
    }
});

// POST /admin/scrape/stop/:adapterName — request stop of running adapter scrape
router.post("/admin/scrape/stop/:adapterName", async (req, res, next) => {
    try {
        const adapterName = req.params.adapterName;

        const adapter = getAdapterByName(adapterName);
        if (!adapter) {
            return res.status(404).json({ error: `Adapter "${adapterName}" not found` });
        }

        requestStop(adapterName);

        logger.info(`[Admin] Stop requested for adapter: ${adapterName}`);

        res.json({
            success: true,
            message: `Scraping stopped for ${adapterName}`,
            adapter: adapterName,
        });
    } catch (err) {
        return next(err);
    }
});

module.exports = router;
