const CompanyV2 = require("../../model/companyV2.schema");
const JobV2 = require("../../model/jobV2.schema");
const { apiErrorHandler, escapeRegex } = require("../../Helpers/controllerHelper");
const { generateCompanySlug, validateSlug } = require("../../utils/slugify");

/**
 * POST /api/admin/companies/v2 — Create a CompanyV2
 */
exports.createCompanyV2 = async (req, res) => {
    try {
        const data = req.validated;

        let slug = data.slug;

        if (slug) {
            const check = validateSlug(slug);
            if (!check.valid) {
                return res.status(400).json({ error: check.error });
            }
            const existing = await CompanyV2.findOne({ slug }).select("_id").lean();
            if (existing) {
                return res.status(409).json({ error: "A company with this slug already exists" });
            }
        } else {
            slug = generateCompanySlug(data.companyName);
            const collision = await CompanyV2.findOne({ slug }).select("_id").lean();
            if (collision) {
                return res.status(409).json({
                    error: "A company with this slug already exists. Provide a custom slug.",
                });
            }
        }

        const company = await CompanyV2.create({ ...data, slug });

        return res.status(201).json({
            message: "CompanyV2 created",
            data: company,
        });
    } catch (err) {
        if (err.code === 11000) {
            return res.status(409).json({ error: "A company with this slug already exists" });
        }
        return apiErrorHandler(err, res);
    }
};

/**
 * GET /api/admin/companies/v2 — Paginated list
 */
exports.listCompaniesV2 = async (req, res) => {
    try {
        const { page = 1, limit = 20, status, search, industry } = req.validatedQuery || {};
        const pageNum = Math.max(parseInt(page) || 1, 1);
        const pageSize = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
        const skip = (pageNum - 1) * pageSize;

        const conditions = { deletedAt: null };
        if (status) conditions.status = status;
        if (industry) conditions.industry = industry;
        if (search) conditions.companyName = { $regex: escapeRegex(search), $options: "i" };

        const [companies, total] = await Promise.all([
            CompanyV2.find(conditions).sort({ companyName: 1 }).skip(skip).limit(pageSize).lean(),
            CompanyV2.countDocuments(conditions),
        ]);

        return res.status(200).json({
            companies,
            total,
            page: pageNum,
            totalPages: Math.ceil(total / pageSize),
        });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};

/**
 * GET /api/admin/companies/v2/:id — Fetch single CompanyV2 with openJobsCount
 */
exports.getCompanyV2 = async (req, res) => {
    try {
        const id = req.params.id;

        const company = await CompanyV2.findOne({ _id: id, deletedAt: null }).lean();
        if (!company) return res.status(404).json({ error: "Company not found" });

        const openJobsCount = await JobV2.countDocuments({
            company: id,
            status: "published",
            deletedAt: null,
        });

        return res.status(200).json({ data: { ...company, openJobsCount } });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};

/**
 * PATCH /api/admin/companies/v2/:id — Update CompanyV2
 */
exports.updateCompanyV2 = async (req, res) => {
    try {
        const id = req.params.id;
        const data = req.validated;

        if (data.slug) {
            const check = validateSlug(data.slug);
            if (!check.valid) {
                return res.status(400).json({ error: check.error });
            }
            const conflict = await CompanyV2.findOne({ slug: data.slug, _id: { $ne: id } })
                .select("_id")
                .lean();
            if (conflict) {
                return res.status(409).json({ error: "A company with this slug already exists" });
            }
        }

        const updated = await CompanyV2.findOneAndUpdate(
            { _id: id, deletedAt: null },
            { $set: data },
            { new: true, runValidators: true }
        );

        if (!updated) return res.status(404).json({ error: "Company not found" });

        return res.status(200).json({ data: updated });
    } catch (err) {
        if (err.code === 11000) {
            return res.status(409).json({ error: "A company with this slug already exists" });
        }
        return apiErrorHandler(err, res);
    }
};

/**
 * DELETE /api/admin/companies/v2/:id — Soft delete (blocks if active jobs exist)
 */
exports.deleteCompanyV2 = async (req, res) => {
    try {
        const id = req.params.id;

        const activeJobs = await JobV2.countDocuments({
            company: id,
            status: "published",
            deletedAt: null,
        });

        if (activeJobs > 0) {
            return res.status(409).json({
                error: `Cannot archive: ${activeJobs} active jobs reference this company. Archive or reassign those jobs first.`,
            });
        }

        const updated = await CompanyV2.findOneAndUpdate(
            { _id: id, deletedAt: null },
            { $set: { deletedAt: new Date(), status: "archived" } },
            { new: true }
        );

        if (!updated) return res.status(404).json({ error: "Company not found" });

        return res.status(200).json({
            message: "Company archived",
            data: { _id: updated._id, deletedAt: updated.deletedAt, status: updated.status },
        });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};
