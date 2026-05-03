const mongoose = require("mongoose");
const JobV2 = require("../../model/jobV2.schema");
const CompanyV2 = require("../../model/companyV2.schema");

const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const PUBLIC_LIST_FIELDS = [
    "_id",
    "slug",
    "title",
    "companyName",
    "company",
    "displayMode",
    "employmentType",
    "workMode",
    "batch",
    "experience",
    "baseSalary",
    "jobLocation",
    "requiredSkills",
    "topicTags",
    "datePosted",
    "validThrough",
    "sponsorship",
    "priority",
];

const PUBLIC_COMPANY_LITE = "_id slug logo isVerified companyType website industry";

const PUBLIC_COMPANY_FULL =
    "_id slug companyName logo description isVerified companyType industry website careerPageLink headquarters foundedYear employeeCount ratings socialLinks tags techStack locations sponsorship";

function publishedJobsFilter(extra = {}) {
    return { status: "published", deletedAt: null, ...extra };
}

function parseList(value) {
    if (value == null) return null;
    return String(value)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}

function jsonNotFound(res, message = "Resource not found") {
    return res.status(404).json({ error: "not_found", message });
}

function jsonGone(res) {
    return res.status(410).json({ error: "gone" });
}

function jsonError(res, err) {
    console.error("[jobsV2Public]", err);
    return res.status(500).json({ error: "internal_error" });
}

function projectListFields(doc) {
    const out = {};
    for (const k of PUBLIC_LIST_FIELDS) {
        if (doc[k] !== undefined) out[k] = doc[k];
    }
    return out;
}

function buildBaseSort(sortParam) {
    switch (sortParam) {
        case "priority:desc":
            return { priority: -1, datePosted: -1 };
        case "sponsorship:desc":
            return null;
        case "datePosted:desc":
        default:
            return { datePosted: -1 };
    }
}

const TIER_RANK_PIPELINE = {
    $switch: {
        branches: [
            { case: { $eq: ["$sponsorship.tier", "sponsored"] }, then: 3 },
            { case: { $eq: ["$sponsorship.tier", "featured"] }, then: 2 },
            { case: { $eq: ["$sponsorship.tier", "boosted"] }, then: 1 },
        ],
        default: 0,
    },
};

async function querySponsorshipRanked(filter, skip, limit) {
    const pipeline = [
        { $match: filter },
        { $addFields: { _tierRank: TIER_RANK_PIPELINE } },
        { $sort: { _tierRank: -1, priority: -1, datePosted: -1 } },
        { $skip: skip },
        { $limit: limit },
        { $project: { _tierRank: 0 } },
    ];
    let docs = await JobV2.aggregate(pipeline);
    docs = await CompanyV2.populate(docs, { path: "company", select: PUBLIC_COMPANY_LITE });
    return docs.map(projectListFields);
}

function buildListFilter(query) {
    const filter = publishedJobsFilter();
    const includeExpired = query.includeExpired === "1" || query.includeExpired === "true";
    const andClauses = [];

    if (!includeExpired) {
        andClauses.push({
            $or: [
                { validThrough: { $exists: false } },
                { validThrough: null },
                { validThrough: { $gte: new Date() } },
            ],
        });
    }

    const batchList = parseList(query.batch);
    if (batchList && batchList.length) {
        const nums = batchList.map(Number).filter((n) => !Number.isNaN(n));
        if (nums.length) filter.batch = { $in: nums };
    }

    const employmentList = parseList(query.employmentType);
    if (employmentList && employmentList.length) {
        filter.employmentType = { $in: employmentList };
    }

    if (query.workMode) {
        filter.workMode = query.workMode;
    }

    const tags = parseList(query.topicTags);
    if (tags && tags.length) {
        filter.topicTags = { $in: tags };
    }

    if (query.search) {
        const safe = escapeRegex(String(query.search));
        andClauses.push({
            $or: [
                { title: { $regex: safe, $options: "i" } },
                { companyName: { $regex: safe, $options: "i" } },
            ],
        });
    }

    if (query.exclude) {
        filter.slug = { $ne: String(query.exclude) };
    }

    if (andClauses.length) {
        filter.$and = andClauses;
    }

    return filter;
}

exports.listJobs = async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const skip = (page - 1) * limit;

        const filter = buildListFilter(req.query);

        if (req.query.company) {
            const companyDoc = await CompanyV2.findOne({
                slug: String(req.query.company),
                status: "active",
                deletedAt: null,
            })
                .select("_id")
                .lean();
            if (!companyDoc) {
                return res.status(200).json({
                    data: [],
                    total: 0,
                    page,
                    limit,
                    totalPages: 0,
                    hasMore: false,
                });
            }
            filter.company = companyDoc._id;
        }

        const sortParam = req.query.sort || "datePosted:desc";
        const sortObj = buildBaseSort(sortParam);

        let docs;
        let total;

        if (sortObj) {
            [docs, total] = await Promise.all([
                JobV2.find(filter)
                    .select(PUBLIC_LIST_FIELDS.join(" "))
                    .populate("company", PUBLIC_COMPANY_LITE)
                    .sort(sortObj)
                    .skip(skip)
                    .limit(limit)
                    .lean(),
                JobV2.countDocuments(filter),
            ]);
        } else {
            [docs, total] = await Promise.all([
                querySponsorshipRanked(filter, skip, limit),
                JobV2.countDocuments(filter),
            ]);
        }

        return res.status(200).json({
            data: docs,
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

exports.getJobBySlug = async (req, res) => {
    try {
        const job = await JobV2.findOne({
            slug: String(req.params.slug),
            status: "published",
            deletedAt: null,
        })
            .populate("company", PUBLIC_COMPANY_FULL)
            .lean();

        if (!job) return jsonNotFound(res, "Job not found");

        const isExpired =
            job.validThrough instanceof Date
                ? job.validThrough.getTime() < Date.now()
                : job.validThrough && new Date(job.validThrough).getTime() < Date.now();

        return res.status(200).json({ ...job, isExpired: !!isExpired });
    } catch (err) {
        return jsonError(res, err);
    }
};

exports.resolveLegacyId = async (req, res) => {
    try {
        const rawId = String(req.params.id || "");
        const orClauses = [{ v1Id: rawId }];
        if (mongoose.Types.ObjectId.isValid(rawId)) {
            orClauses.push({ v1Id: new mongoose.Types.ObjectId(rawId) });
        }

        const doc = await JobV2.findOne({ $or: orClauses }).select("slug status deletedAt").lean();
        if (!doc) return jsonGone(res);
        if (doc.status !== "published" || doc.deletedAt) return jsonGone(res);

        return res.status(200).json({ slug: doc.slug });
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

        const docs = await JobV2.find(publishedJobsFilter()).select("slug").lean();
        const slugs = docs.map((d) => d.slug).filter(Boolean);
        SLUGS_CACHE.data = slugs;
        SLUGS_CACHE.expiresAt = now + SLUGS_TTL_MS;

        res.set("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
        return res.status(200).json({ slugs });
    } catch (err) {
        return jsonError(res, err);
    }
};

function fireAndForgetIncrement(slug, field) {
    JobV2.updateOne(
        { slug, status: "published", deletedAt: null },
        { $inc: { [field]: 1 } }
    ).catch((err) => {
        console.warn(`[jobsV2Public] ${field} increment failed for ${slug}:`, err.message);
    });
}

exports.trackView = (req, res) => {
    res.status(204).end();
    fireAndForgetIncrement(String(req.params.slug), "stats.pageViews");
};

exports.trackApply = (req, res) => {
    res.status(204).end();
    fireAndForgetIncrement(String(req.params.slug), "stats.applyClicks");
};

exports.notFound = (req, res) => {
    return res.status(404).json({ error: "not_found", message: "Endpoint not found" });
};

exports._internals = {
    publishedJobsFilter,
    buildListFilter,
    PUBLIC_LIST_FIELDS,
    PUBLIC_COMPANY_LITE,
    TIER_RANK_PIPELINE,
    querySponsorshipRanked,
    projectListFields,
};
