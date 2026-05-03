const CompanyV2 = require("../../model/companyV2.schema");
const JobV2 = require("../../model/jobV2.schema");
const jobsCtrl = require("./jobsV2Public.controllers");

const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const COMPANY_LIST_FIELDS = [
    "_id",
    "slug",
    "companyName",
    "logo",
    "description",
    "isVerified",
    "companyType",
    "industry",
    "headquarters",
    "employeeCount",
    "stats",
    "sponsorship",
];

const COMPANY_DETAIL_FIELDS = [
    "_id",
    "slug",
    "companyName",
    "logo",
    "description",
    "companyType",
    "industry",
    "tags",
    "techStack",
    "headquarters",
    "locations",
    "foundedYear",
    "employeeCount",
    "website",
    "careerPageLink",
    "socialLinks",
    "ratings",
    "isVerified",
    "sponsorship",
    "seo",
    "createdAt",
    "updatedAt",
];

function activeCompanyFilter(extra = {}) {
    return { status: "active", deletedAt: null, ...extra };
}

function jsonNotFound(res, message = "Resource not found") {
    return res.status(404).json({ error: "not_found", message });
}

function jsonError(res, err) {
    console.error("[companiesV2Public]", err);
    return res.status(500).json({ error: "internal_error" });
}

function pickFields(doc, fields) {
    const out = {};
    for (const k of fields) {
        if (doc[k] !== undefined) out[k] = doc[k];
    }
    return out;
}

function projectListItem(doc) {
    const out = pickFields(doc, COMPANY_LIST_FIELDS);
    if (out.description && typeof out.description === "object") {
        out.description = { short: out.description.short };
    }
    if (out.stats) {
        out.stats = { openJobsCount: out.stats.openJobsCount || 0 };
    }
    if (out.sponsorship) {
        out.sponsorship = { tier: out.sponsorship.tier || "none" };
    }
    return out;
}

exports.listCompanies = async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const skip = (page - 1) * limit;

        const filter = activeCompanyFilter();

        if (req.query.search) {
            const safe = escapeRegex(String(req.query.search));
            filter.companyName = { $regex: safe, $options: "i" };
        }

        const types = req.query.companyType
            ? String(req.query.companyType).split(",").map((s) => s.trim()).filter(Boolean)
            : null;
        if (types && types.length) {
            filter.companyType = { $in: types };
        }

        if (req.query.industry) {
            filter.industry = String(req.query.industry);
        }

        const sortParam = req.query.sort || "companyName:asc";
        let sortObj;
        switch (sortParam) {
            case "companyName:desc":
                sortObj = { companyName: -1 };
                break;
            case "createdAt:desc":
                sortObj = { createdAt: -1 };
                break;
            case "companyName:asc":
            default:
                sortObj = { companyName: 1 };
        }

        const [docs, total] = await Promise.all([
            CompanyV2.find(filter)
                .select(COMPANY_LIST_FIELDS.join(" "))
                .sort(sortObj)
                .skip(skip)
                .limit(limit)
                .lean(),
            CompanyV2.countDocuments(filter),
        ]);

        return res.status(200).json({
            data: docs.map(projectListItem),
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit) || 0,
            hasMore: skip + docs.length < total,
        });
    } catch (err) {
        return jsonError(res, err);
    }
};

exports.getCompanyBySlug = async (req, res) => {
    try {
        const slug = String(req.params.slug);
        const company = await CompanyV2.findOne(activeCompanyFilter({ slug }))
            .select(COMPANY_DETAIL_FIELDS.join(" "))
            .lean();

        if (!company) return jsonNotFound(res, "Company not found");

        const jobFilter = jobsCtrl._internals.publishedJobsFilter({
            company: company._id,
            $or: [
                { validThrough: { $exists: false } },
                { validThrough: null },
                { validThrough: { $gte: new Date() } },
            ],
        });

        const [recentJobs, openJobsCount] = await Promise.all([
            jobsCtrl._internals.querySponsorshipRanked(jobFilter, 0, 20),
            JobV2.countDocuments(
                jobsCtrl._internals.publishedJobsFilter({ company: company._id })
            ),
        ]);

        return res.status(200).json({
            ...company,
            recentJobs,
            stats: { openJobsCount },
        });
    } catch (err) {
        return jsonError(res, err);
    }
};

const SLUGS_CACHE = { data: null, expiresAt: 0 };
const SLUGS_TTL_MS = 5 * 60 * 1000;

exports.listSlugs = async (req, res) => {
    try {
        const now = Date.now();
        if (SLUGS_CACHE.data && SLUGS_CACHE.expiresAt > now) {
            res.set("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
            return res.status(200).json({ slugs: SLUGS_CACHE.data });
        }

        const docs = await CompanyV2.find(activeCompanyFilter()).select("slug").lean();
        const slugs = docs.map((d) => d.slug).filter(Boolean);
        SLUGS_CACHE.data = slugs;
        SLUGS_CACHE.expiresAt = now + SLUGS_TTL_MS;

        res.set("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
        return res.status(200).json({ slugs });
    } catch (err) {
        return jsonError(res, err);
    }
};

exports.notFound = (req, res) => {
    return res.status(404).json({ error: "not_found", message: "Endpoint not found" });
};
