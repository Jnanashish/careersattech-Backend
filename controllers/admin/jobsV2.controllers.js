const JobV2 = require("../../model/jobV2.schema");
const { apiErrorHandler } = require("../../Helpers/controllerHelper");
const { generateJobSlug, validateSlug } = require("../../utils/slugify");

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
        const { page = 1, limit = 20, status, search, company } = req.validatedQuery || {};
        const pageNum = Math.max(parseInt(page) || 1, 1);
        const pageSize = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
        const skip = (pageNum - 1) * pageSize;

        const conditions = { deletedAt: null };
        if (status) conditions.status = status;
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
 * DELETE /api/admin/jobs/v2/:id — Soft delete
 */
exports.deleteJobV2 = async (req, res) => {
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
