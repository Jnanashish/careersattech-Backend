const JobV2 = require("../jobsV2/jobsV2.model");
const JobClickV2 = require("./jobClickV2.model");
const { apiErrorHandler } = require("../../utils/controllerHelper");
const { validateSlug } = require("../../utils/slugify");
const { resolveUniqueJobSlug } = require("./resolveJobSlug");
const logger = require("../../utils/logger");

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
            slug = await resolveUniqueJobSlug(data.companyName, data.title);
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
        const {
            page = 1,
            limit = 20,
            status,
            search,
            company,
            excludeArchived,
            employmentType,
            batch,
        } = req.validatedQuery || {};
        const pageNum = Math.max(parseInt(page) || 1, 1);
        const pageSize = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
        const skip = (pageNum - 1) * pageSize;

        const conditions = {};

        // A job reaches "archived" two ways: the cron sweeps set status only,
        // while POST /:id/archive also stamps deletedAt. Asking for archived
        // jobs therefore must NOT filter on deletedAt, or the ones archived
        // from the admin UI would be invisible — and unrestorable.
        if (status === "archived") {
            conditions.status = "archived";
        } else if (status) {
            conditions.status = status;
            conditions.deletedAt = null;
        } else if (excludeArchived === "true") {
            conditions.status = { $ne: "archived" };
            conditions.deletedAt = null;
        } else {
            conditions.deletedAt = null;
        }

        if (company) conditions.company = company;
        // employmentType and batch are arrays on the document; an equality match
        // against a scalar means "array contains".
        if (employmentType) conditions.employmentType = employmentType;
        if (batch) conditions.batch = batch;
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
 * POST /api/admin/jobs/v2/:id/archive — Soft delete (reversible)
 *
 * Sets deletedAt + status "archived". The document stays in Mongo, so the job
 * can be restored and its click history keeps resolving. Use DELETE /:id when
 * the row should actually leave the database.
 */
exports.archiveJobV2 = async (req, res) => {
    try {
        const updated = await JobV2.findOneAndUpdate(
            { _id: req.params.id, deletedAt: null },
            { $set: { deletedAt: new Date(), status: "archived" } },
            { new: true }
        );

        if (!updated) return res.status(404).json({ error: "Job not found" });

        return res.status(200).json({
            message: "Job archived",
            data: { _id: updated._id, deletedAt: updated.deletedAt, status: updated.status },
        });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};

/**
 * POST /api/admin/jobs/v2/:id/restore — Undo an archive
 *
 * Clears deletedAt and returns the job to "draft" rather than "published": a
 * job is usually archived because its apply link died, so re-publishing has to
 * be a deliberate second step after someone checks the link.
 *
 * 404 when the job isn't currently archived (already restored, or never
 * archived) — the admin UI treats that as a benign race, not an error.
 */
exports.restoreJobV2 = async (req, res) => {
    try {
        const restored = await JobV2.findOneAndUpdate(
            {
                _id: req.params.id,
                // Two shapes count as archived: the cron sweeps set status
                // alone, POST /:id/archive also sets deletedAt. Restore has to
                // accept both, or the Restore button 404s on cron-archived jobs.
                $or: [{ deletedAt: { $ne: null } }, { status: "archived" }],
            },
            { $set: { deletedAt: null, status: "draft", archivedAt: null, archivedReason: null } },
            { new: true }
        );

        if (!restored) {
            return res.status(404).json({ error: "Job not found or not archived" });
        }

        return res.status(200).json({
            message: "Job restored",
            data: { _id: restored._id, deletedAt: restored.deletedAt, status: restored.status },
        });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};

/**
 * DELETE /api/admin/jobs/v2/:id?permanent=true — Permanent delete (irreversible)
 *
 * Removes the job document outright and drops its click events, which would
 * otherwise dangle against a missing job ref. Frees the unique slug for reuse.
 * Matches an already-archived job too — archiving first then deleting is the
 * expected two-step flow.
 */
exports.hardDeleteJobV2 = async (req, res) => {
    try {
        const deleted = await JobV2.findByIdAndDelete(req.params.id);

        if (!deleted) return res.status(404).json({ error: "Job not found" });

        // Click events are analytics-only; failing to clear them must not turn a
        // completed delete into an error response.
        let clickEventsDeleted = 0;
        try {
            const clicks = await JobClickV2.deleteMany({ job: deleted._id });
            clickEventsDeleted = clicks.deletedCount || 0;
        } catch (clickErr) {
            logger.error(
                `[jobs:v2] failed to clear click events for deleted job ${deleted._id}: ${clickErr.message}`
            );
        }

        return res.status(200).json({
            message: "Job permanently deleted",
            data: { _id: deleted._id, slug: deleted.slug, clickEventsDeleted },
        });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};
