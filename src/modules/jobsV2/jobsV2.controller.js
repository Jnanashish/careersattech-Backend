const JobV2 = require("../jobsV2/jobsV2.model");
const { apiErrorHandler } = require("../../utils/controllerHelper");
const { generateJobSlug, validateSlug } = require("../../utils/slugify");
const { archiveJob, restoreJob, MANUAL_ARCHIVE_REASON } = require("./jobsV2.lifecycle");

const MAX_SLUG_ATTEMPTS = 5;

/**
 * POST /api/admin/jobs/v2 — Create a JobV2
 */
exports.createJobV2 = async (req, res) => {
    try {
        const data = req.validated;

        let slug = data.slug;

        if (slug) {
            const check = validateSlug(slug);
            if (!check.valid) {
                return res.status(400).json({ error: check.error });
            }
            const existing = await JobV2.findOne({ slug }).select("_id").lean();
            if (existing) {
                return res.status(409).json({ error: "A job with this slug already exists" });
            }
        } else {
            let attempts = 0;
            while (attempts < MAX_SLUG_ATTEMPTS) {
                const candidate = generateJobSlug(data.companyName, data.title);
                const collision = await JobV2.findOne({ slug: candidate }).select("_id").lean();
                if (!collision) {
                    slug = candidate;
                    break;
                }
                attempts += 1;
            }
            if (!slug) {
                return res.status(500).json({ error: "Could not generate unique slug" });
            }
        }

        const job = await JobV2.create({ ...data, slug });

        return res.status(201).json({
            message: "JobV2 created",
            data: job,
        });
    } catch (err) {
        if (err.code === 11000) {
            return res.status(409).json({ error: "A job with this slug already exists" });
        }
        if (err.name === "ValidationError") {
            return res.status(400).json({
                error: "Validation failed",
                details: Object.values(err.errors).map((e) => ({
                    path: e.path,
                    message: e.message,
                })),
            });
        }
        return apiErrorHandler(err, res);
    }
};

/**
 * GET /api/admin/jobs/v2 — Paginated list
 */
exports.listJobsV2 = async (req, res) => {
    try {
        const { page = 1, limit = 20, status, search, company, excludeArchived } =
            req.validatedQuery || {};
        const pageNum = Math.max(parseInt(page) || 1, 1);
        const pageSize = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
        const skip = (pageNum - 1) * pageSize;

        const conditions = { deletedAt: null };
        // Explicit status wins; otherwise the Active tab asks to hide archived.
        if (status) conditions.status = status;
        else if (excludeArchived === "true") conditions.status = { $ne: "archived" };
        if (company) conditions.company = company;
        if (search) conditions.$text = { $search: search };

        const [jobs, total] = await Promise.all([
            JobV2.find(conditions).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
            JobV2.countDocuments(conditions),
        ]);

        return res.status(200).json({
            jobs,
            total,
            page: pageNum,
            totalPages: Math.ceil(total / pageSize),
        });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};

/**
 * GET /api/admin/jobs/v2/:id — Fetch single JobV2
 */
exports.getJobV2 = async (req, res) => {
    try {
        const job = await JobV2.findOne({ _id: req.params.id, deletedAt: null })
            .populate("company", "companyName slug logo")
            .lean();

        if (!job) return res.status(404).json({ error: "Job not found" });

        return res.status(200).json({ data: job });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};

/**
 * PATCH /api/admin/jobs/v2/:id — Update JobV2
 */
exports.updateJobV2 = async (req, res) => {
    try {
        const id = req.params.id;
        const data = req.validated;

        if (data.slug) {
            const check = validateSlug(data.slug);
            if (!check.valid) {
                return res.status(400).json({ error: check.error });
            }
            const conflict = await JobV2.findOne({ slug: data.slug, _id: { $ne: id } })
                .select("_id")
                .lean();
            if (conflict) {
                return res.status(409).json({ error: "A job with this slug already exists" });
            }
        }

        const updated = await JobV2.findOneAndUpdate(
            { _id: id, deletedAt: null },
            { $set: data },
            { new: true, runValidators: true }
        );

        if (!updated) return res.status(404).json({ error: "Job not found" });

        return res.status(200).json({ data: updated });
    } catch (err) {
        if (err.code === 11000) {
            return res.status(409).json({ error: "A job with this slug already exists" });
        }
        if (err.name === "ValidationError") {
            return res.status(400).json({
                error: "Validation failed",
                details: Object.values(err.errors).map((e) => ({
                    path: e.path,
                    message: e.message,
                })),
            });
        }
        return apiErrorHandler(err, res);
    }
};

/**
 * POST /api/admin/jobs/v2/:id/archive — Soft-archive (the default removal).
 *
 * Sets status="archived" + archivedAt + archivedReason="manual". Does NOT set
 * deletedAt, so the job drops out of public browse/search/sitemap but its detail
 * URL still resolves (frontend can render an "expired" state). Reversible via
 * the restore endpoint.
 */
exports.archiveJobV2 = async (req, res) => {
    try {
        const job = await archiveJob(req.params.id, MANUAL_ARCHIVE_REASON);
        if (!job) return res.status(404).json({ error: "Job not found" });

        return res.status(200).json({
            message: "Job archived",
            data: {
                _id: job._id,
                status: job.status,
                archivedAt: job.archivedAt,
                archivedReason: job.archivedReason,
            },
        });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};

/**
 * POST /api/admin/jobs/v2/:id/restore — Undo an archive.
 *
 * Sets status="published", clears archivedAt + archivedReason. Only acts on a
 * currently-archived, non-deleted job. The parent company's openJobsCount is
 * computed live (countDocuments status:"published"), so it self-heals — nothing
 * to increment here.
 */
exports.restoreJobV2 = async (req, res) => {
    try {
        const job = await restoreJob(req.params.id);
        if (!job) return res.status(404).json({ error: "Job not found or not archived" });

        return res.status(200).json({
            message: "Job restored",
            data: { _id: job._id, status: job.status, archivedAt: job.archivedAt },
        });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};

/**
 * DELETE /api/admin/jobs/v2/:id — Permanent hard-delete. GUARDED.
 *
 * Archiving is the default (POST /:id/archive). This route refuses unless the
 * caller opts in with ?permanent=true, so a stray DELETE can never destroy data.
 * Reserved for genuine junk; the document is removed irrecoverably.
 */
exports.deleteJobV2 = async (req, res) => {
    try {
        const permanent = req.query.permanent === "true" || req.query.permanent === true;
        if (!permanent) {
            return res.status(400).json({
                error:
                    "Refusing to hard-delete. Use POST /api/admin/jobs/v2/:id/archive to archive (default), or pass ?permanent=true to permanently delete.",
            });
        }

        const deleted = await JobV2.findOneAndDelete({ _id: req.params.id });
        if (!deleted) return res.status(404).json({ error: "Job not found" });

        return res.status(200).json({
            message: "Job permanently deleted",
            data: { _id: deleted._id, slug: deleted.slug },
        });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};
