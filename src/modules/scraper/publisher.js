const CompanyV2 = require("../companiesV2/companiesV2.model");
const JobV2 = require("./../jobsV2/jobsV2.model");
const StagingJob = require("./models/stagingJob.model");
const { findCompanyByName } = require("./ingester");
const { generateCompanySlug } = require("../../utils/slugify");
const { resolveUniqueJobSlug } = require("../jobsV2/resolveJobSlug");
const logger = require("../../utils/logger");

/**
 * Shared publish routine for scraped jobs.
 *
 * This is the single, tested path that turns a StagingJob into a live JobV2:
 * resolve (or create) the CompanyV2, build the JobV2 payload, gate on
 * publish-readiness, create the job, and stamp audit fields back on staging.
 *
 * Two callers share it:
 *   - scraper.scheduler.js     → auto-publish bypass (default; skips review)
 *   - scraper.admin.routes.js  → manual approve / approve-bulk, still available
 *     for jobs the bypass left behind (not publish-ready)
 *
 * Extracted here (rather than left in the routes file) so the scheduler can
 * reuse it without importing the Express router — that would create a circular
 * dependency, since the router already imports runPipeline from the scheduler.
 */

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

    const slug = overrides.slug || (await resolveUniqueJobSlug(company.companyName, jobData.title));

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
        const scrapedAtMs = staging.scrapedAt
            ? new Date(staging.scrapedAt).getTime()
            : now.getTime();
        const nowMs = now.getTime();
        const lo = Math.min(scrapedAtMs, nowMs);
        const hi = nowMs;
        const randMs = lo + Math.floor(Math.random() * (hi - lo + 1));
        payload.datePosted = new Date(randMs);
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

/**
 * Auto-publish bypass: run freshly-staged jobs straight through the approve
 * routine without waiting for human review. This is the scraper pipeline's
 * default path (disable with SCRAPER_AUTO_PUBLISH=false, or per run with
 * autoPublish: false).
 *
 * Failure isolation is per-job: a validation miss or duplicate-key conflict on
 * one staging row never aborts the batch. Jobs that fail the publish-readiness
 * gate are left as `pending` in staging, so they still surface in the manual
 * review queue instead of being lost.
 *
 * @param {import("mongoose").Document[]} stagingDocs freshly created StagingJob docs
 * @param {{ approvedBy?: string }} [opts]
 * @returns {Promise<{ published: number, failed: number }>}
 */
async function autoPublishStaged(stagingDocs, opts = {}) {
    const approvedBy = opts.approvedBy || "auto-scraper";
    let published = 0;
    let failed = 0;

    for (const staging of stagingDocs) {
        const title = staging?.jobData?.title || "(untitled)";
        try {
            const result = await approveStagingJob(staging, {}, approvedBy);
            if (result.fieldErrors) {
                failed++;
                const reason = result.fieldErrors.map((e) => `${e.path}: ${e.message}`).join("; ");
                logger.warn(`[AutoPublish] Left in staging (not publish-ready): ${title} — ${reason}`);
                await recordAutoPublishFailure(staging, reason);
                continue;
            }
            published++;
            logger.info(`[AutoPublish] Published: ${title} (${result.job._id})`);
        } catch (err) {
            failed++;
            const reason = isDuplicateKeyError(err) ? duplicateKeyMessage(err) : err.message;
            logger.error(`[AutoPublish] Failed to publish "${title}": ${reason}`);
            await recordAutoPublishFailure(staging, reason);
        }
    }

    return { published, failed };
}

/**
 * A pending row that keeps failing the readiness gate would otherwise be retried
 * by every single run forever. After this many attempts the drain leaves it
 * alone and it waits for a human in the review queue.
 */
const MAX_AUTO_PUBLISH_ATTEMPTS = 3;

/**
 * Stamp the failure on the staging row so the drain can stop retrying it and an
 * admin can see why it never went live. Best-effort: a bookkeeping write that
 * fails must not turn a skipped job into a thrown pipeline error.
 */
async function recordAutoPublishFailure(staging, reason) {
    if (!staging || typeof staging.save !== "function") return;
    try {
        staging.autoPublishAttempts = (staging.autoPublishAttempts || 0) + 1;
        staging.lastAutoPublishError = String(reason || "").slice(0, 500);
        await staging.save();
    } catch (err) {
        logger.warn(`[AutoPublish] Could not record failure on staging row: ${err.message}`);
    }
}

/**
 * Drain the pending backlog.
 *
 * `autoPublishStaged` only ever sees the rows a run just created, so anything
 * staged before the bypass existed (or left behind while it was off) would sit
 * `pending` forever — dedupe means a re-scrape skips those jobs instead of
 * re-staging them. This sweeps the queue itself and publishes what is ready.
 *
 * Rows that have already failed MAX_AUTO_PUBLISH_ATTEMPTS times are skipped
 * (pass `retryExhausted: true` to include them anyway). The `$exists: false`
 * arm matters: rows staged before this field existed have no counter at all,
 * and a bare `$lt` would silently exclude exactly the backlog we came for.
 *
 * @param {{ limit?: number, source?: string, retryExhausted?: boolean, approvedBy?: string }} [opts]
 * @returns {Promise<{ scanned: number, published: number, failed: number }>}
 */
async function publishPendingBacklog(opts = {}) {
    const parsedLimit = parseInt(opts.limit, 10);
    const limit = Math.min(Math.max(Number.isNaN(parsedLimit) ? 100 : parsedLimit, 1), 500);

    const filter = { status: "pending" };
    if (opts.source) filter.source = opts.source;
    if (!opts.retryExhausted) {
        filter.$or = [
            { autoPublishAttempts: { $exists: false } },
            { autoPublishAttempts: { $lt: MAX_AUTO_PUBLISH_ATTEMPTS } },
        ];
    }

    const docs = await StagingJob.find(filter).sort({ scrapedAt: 1 }).limit(limit);
    if (docs.length === 0) return { scanned: 0, published: 0, failed: 0 };

    const { published, failed } = await autoPublishStaged(docs, {
        approvedBy: opts.approvedBy || "auto-scraper:backlog",
    });

    return { scanned: docs.length, published, failed };
}

module.exports = {
    ensureCompanyForStaging,
    isDuplicateKeyError,
    duplicateKeyMessage,
    buildJobV2Payload,
    validatePublishReadiness,
    mongooseValidationToFieldErrors,
    approveStagingJob,
    autoPublishStaged,
    publishPendingBacklog,
    MAX_AUTO_PUBLISH_ATTEMPTS,
};
