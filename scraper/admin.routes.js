const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const StagingJob = require("./models/StagingJob");
const ScrapeLog = require("./models/ScrapeLog");
const JobV2 = require("../model/jobV2.schema");
const CompanyV2 = require("../model/companyV2.schema");
const { runPipeline } = require("./scheduler");
const { scrapeOne, getAdapterByName } = require("./scraper");
const { findCompanyByName } = require("./ingester");
const { generateJobSlug, generateCompanySlug } = require("../utils/slugify");
const { requestStop, getAll: getStopFlags } = require("./stopFlags");

// Auth middleware — checks x-admin-secret header
function requireAdminSecret(req, res, next) {
    const secret = req.headers["x-admin-secret"];
    if (!secret || secret !== process.env.ADMIN_SECRET) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    next();
}

router.use("/admin/scrape", requireAdminSecret);

/**
 * Resolve (or create) the CompanyV2 for a staging row.
 * Order: pre-linked staging.matchedCompany → existing CompanyV2 by name → create from companyData.
 */
async function ensureCompanyForStaging(staging) {
    if (staging.matchedCompany) {
        const linked = await CompanyV2.findById(staging.matchedCompany);
        if (linked && !linked.deletedAt) return linked;
    }

    const companyData = staging.companyData?.toObject ? staging.companyData.toObject() : staging.companyData || {};
    const companyName = companyData.companyName || staging.jobData?.companyName;
    if (!companyName) {
        throw new Error("Cannot resolve company: companyName missing from staging");
    }

    const existing = await findCompanyByName(companyName);
    if (existing) return CompanyV2.findById(existing._id);

    // Create a new CompanyV2 from the AI-enriched companyData
    let slug = generateCompanySlug(companyName);
    // Resolve slug collisions deterministically (different company names that slugify to the same value)
    let suffix = 1;
    while (await CompanyV2.findOne({ slug }).select("_id").lean()) {
        suffix++;
        slug = `${generateCompanySlug(companyName)}-${suffix}`;
        if (suffix > 50) {
            throw new Error(`Could not generate unique slug for company "${companyName}"`);
        }
    }

    const createPayload = {
        ...companyData,
        companyName,
        slug,
        source: "scraped",
        status: "active",
    };
    // Never persist v1Id: null — a stale plain-unique index on v1Id will
    // collide on the second null-valued doc. Scraped companies have no
    // legacy v1 id, so omit the field entirely.
    if (createPayload.v1Id == null) delete createPayload.v1Id;

    const created = await CompanyV2.create(createPayload);

    return created;
}

/**
 * E11000 → friendly 409 mapper for the approve flow. The most painful
 * historic failure is a duplicate `v1Id: null` from a stale plain-unique
 * index on companies_v2.v1Id (run migration/scripts/fix-companies-v1Id-index.js
 * to convert it to partial-unique).
 */
function isDuplicateKeyError(err) {
    return err && (err.code === 11000 || err.codeName === "DuplicateKey");
}

function duplicateKeyMessage(err) {
    const keyPattern = err.keyPattern || {};
    const keyValue = err.keyValue || {};
    if (keyPattern.v1Id !== undefined || keyValue.v1Id !== undefined) {
        return "Company conflict — duplicate v1Id";
    }
    const field = Object.keys(keyPattern)[0] || Object.keys(keyValue)[0];
    return field ? `Duplicate key on ${field}` : "Duplicate key conflict";
}

/**
 * Build a JobV2 payload from a staging row + resolved company.
 *
 * Approval semantics:
 * - status defaults to "published" (the whole point of approval is to go live).
 *   Reviewer can explicitly override with overrides.status to keep "draft" etc.
 * - datePosted is forced to "now" if it's missing or stale (older than today UTC),
 *   so the public-facing date reflects when the job actually went live.
 */
async function buildJobV2Payload(staging, company, overrides = {}) {
    const jobData = staging.jobData?.toObject ? staging.jobData.toObject() : { ...staging.jobData };

    let slug = overrides.slug || generateJobSlug(company.companyName, jobData.title);
    // Defensive: handle (extremely unlikely) slug collision from nanoid
    let attempts = 0;
    while (await JobV2.findOne({ slug }).select("_id").lean()) {
        attempts++;
        if (attempts > 5) throw new Error("Could not generate unique job slug after 5 attempts");
        slug = generateJobSlug(company.companyName, jobData.title);
    }

    const payload = {
        ...jobData,
        ...overrides,
        company: company._id,
        companyName: company.companyName,
        slug,
        source: "scraped",
        status: Object.prototype.hasOwnProperty.call(overrides, "status")
            ? overrides.status
            : "published",
    };

    const now = new Date();
    const todayUtcStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
    if (!payload.datePosted || new Date(payload.datePosted) < todayUtcStart) {
        payload.datePosted = now;
    }

    return payload;
}

/**
 * Same publish-readiness gate the manual publish flow relies on (Mongoose
 * `required` + the displayMode pre-validate hook). We run it pre-create so
 * the API can return field-level errors instead of a generic 500, and so
 * we never silently downgrade to draft on missing fields.
 */
function validatePublishReadiness(payload) {
    const errors = [];
    const requireString = (path, value) => {
        if (typeof value !== "string" || value.trim().length === 0) {
            errors.push({ path, message: `${path} is required to publish` });
        }
    };
    const requireNonEmptyArray = (path, value) => {
        if (!Array.isArray(value) || value.length === 0) {
            errors.push({ path, message: `${path} is required to publish` });
        }
    };

    requireString("title", payload.title);
    if (!payload.company) errors.push({ path: "company", message: "company is required to publish" });
    requireString("companyName", payload.companyName);
    requireString("applyLink", payload.applyLink);
    requireNonEmptyArray("employmentType", payload.employmentType);
    requireNonEmptyArray("batch", payload.batch);
    if (!payload.datePosted) {
        errors.push({ path: "datePosted", message: "datePosted is required to publish" });
    }
    requireString("slug", payload.slug);

    if (payload.displayMode === "internal") {
        const html = payload.jobDescription && payload.jobDescription.html;
        if (typeof html !== "string" || html.trim().length === 0) {
            errors.push({
                path: "jobDescription.html",
                message: "jobDescription.html is required when displayMode is 'internal'",
            });
        }
    }

    return errors;
}

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

/**
 * Convert a Mongoose ValidationError to the same {path, message}[] shape we
 * use for our pre-create publish-readiness gate.
 */
function mongooseValidationToFieldErrors(err) {
    return Object.values(err.errors || {}).map((e) => ({
        path: e.path,
        message: e.message,
    }));
}

/**
 * Core approve routine: resolve company, build payload, gate on publish
 * readiness, create job, stamp audit fields on staging.
 *
 * Returns { job } on success, throws on hard errors, or returns
 * { fieldErrors } when the readiness gate or Mongoose validation rejects.
 */
async function approveStagingJob(staging, overrides, approvedBy) {
    const company = await ensureCompanyForStaging(staging);
    const payload = await buildJobV2Payload(staging, company, overrides);

    if (payload.status === "published") {
        const fieldErrors = validatePublishReadiness(payload);
        if (fieldErrors.length > 0) return { fieldErrors };
    }

    payload.approvedBy = approvedBy;
    payload.approvedFromStagingId = staging._id;
    if (payload.status === "published") {
        payload.publishedAt = new Date();
    }

    let newJob;
    try {
        newJob = await JobV2.create(payload);
    } catch (err) {
        if (err.name === "ValidationError") {
            return { fieldErrors: mongooseValidationToFieldErrors(err) };
        }
        throw err;
    }

    staging.status = "approved";
    staging.approvedAt = new Date();
    staging.approvedJob = newJob._id;
    staging.matchedCompany = company._id;
    if (!staging.jobData.company) staging.jobData.company = company._id;
    await staging.save();

    return { job: newJob };
}

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

// POST /admin/scrape/staging/:id/approve — approve, ensure company, create JobV2
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

        const overrides = req.body?.overrides || {};
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
            console.error(`[Admin] Approve duplicate key: ${err.message}`);
            return res.status(409).json({
                error: duplicateKeyMessage(err),
                keyPattern: err.keyPattern,
                keyValue: err.keyValue,
            });
        }
        console.error(`[Admin] Approve failed: ${err.message}`);
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

                const overrides = perJobOverrides[id] || {};
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

        res.json({ data: health, lastRunId: latestLog.runId, activeStopRequests: getStopFlags() });
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

// POST /admin/scrape/stop/:adapterName — request stop of running adapter scrape
router.post("/admin/scrape/stop/:adapterName", async (req, res) => {
    try {
        const adapterName = req.params.adapterName;

        const adapter = getAdapterByName(adapterName);
        if (!adapter) {
            return res.status(404).json({ error: `Adapter "${adapterName}" not found` });
        }

        requestStop(adapterName);

        console.log(`[Admin] Stop requested for adapter: ${adapterName}`);

        res.json({
            success: true,
            message: `Scraping stopped for ${adapterName}`,
            adapter: adapterName,
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

module.exports = router;
