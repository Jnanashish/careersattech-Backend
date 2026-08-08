const CompanyV2 = require("../companiesV2/companiesV2.model");
const JobV2 = require("../jobsV2/jobsV2.model");
const { apiErrorHandler, escapeRegex } = require("../../utils/controllerHelper");
const { generateCompanySlug, validateSlug } = require("../../utils/slugify");
const { findExistingCompany } = require("../../services/jobScrapeFromUrl/resolveCompany");

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
            // No explicit slug → treat as "find or warn". Catch near-duplicate
            // names ("ABC" vs "ABC Private Limited", "Adani" vs "Adani Group")
            // before minting a new company. An explicit slug means the admin
            // is deliberately creating a distinct entry, so that path is skipped.
            const heuristicMatch = await findExistingCompany(data.companyName);
            if (heuristicMatch) {
                return res.status(409).json({
                    error: `A company "${heuristicMatch.companyName}" already exists and looks like the same company. Reuse it, or pass a custom slug to create a distinct entry.`,
                    existingCompany: {
                        _id: heuristicMatch._id,
                        slug: heuristicMatch.slug,
                        companyName: heuristicMatch.companyName,
                    },
                });
            }
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
 * POST /api/admin/companies/v2/:id/archive — Soft delete (reversible)
 *
 * Blocks while published jobs still point here. The document stays in Mongo so
 * archived jobs keep resolving their company ref.
 */
exports.archiveCompanyV2 = async (req, res) => {
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

/**
 * POST /api/admin/companies/v2/:id/restore — Undo an archive
 *
 * Clears deletedAt and returns the company to "inactive" (CompanyV2's status
 * enum is active|inactive|archived — there is no draft). Going live again is a
 * deliberate step. 404 when it isn't currently archived.
 */
exports.restoreCompanyV2 = async (req, res) => {
    try {
        const restored = await CompanyV2.findOneAndUpdate(
            {
                _id: req.params.id,
                $or: [{ deletedAt: { $ne: null } }, { status: "archived" }],
            },
            { $set: { deletedAt: null, status: "inactive" } },
            { new: true }
        );

        if (!restored) {
            return res.status(404).json({ error: "Company not found or not archived" });
        }

        return res.status(200).json({
            message: "Company restored",
            data: { _id: restored._id, deletedAt: restored.deletedAt, status: restored.status },
        });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};

/**
 * DELETE /api/admin/companies/v2/:id?permanent=true — Permanent delete (irreversible)
 *
 * Blocks while ANY job document still references the company — including
 * archived and soft-deleted ones, since JobV2.company is a required ref and
 * removing the company would leave those jobs unresolvable. Frees the unique
 * companyName + slug for reuse.
 */
exports.hardDeleteCompanyV2 = async (req, res) => {
    try {
        const id = req.params.id;

        const referencingJobs = await JobV2.countDocuments({ company: id });

        if (referencingJobs > 0) {
            return res.status(409).json({
                error: `Cannot delete: ${referencingJobs} job(s) still reference this company. Delete or reassign those jobs first.`,
            });
        }

        const deleted = await CompanyV2.findByIdAndDelete(id);

        if (!deleted) return res.status(404).json({ error: "Company not found" });

        return res.status(200).json({
            message: "Company permanently deleted",
            data: { _id: deleted._id, slug: deleted.slug, companyName: deleted.companyName },
        });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};
