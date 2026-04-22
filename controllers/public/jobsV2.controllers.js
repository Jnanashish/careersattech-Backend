const JobV2 = require("../../model/jobV2.schema");
const JobClickV2 = require("../../model/jobClickV2.schema");
const { apiErrorHandler } = require("../../Helpers/controllerHelper");

function buildClickDoc(jobId, eventType, req, referrerOverride) {
    return {
        job: jobId,
        eventType,
        sessionHash: req.sessionHash,
        userAgent: req.headers["user-agent"],
        referrer: referrerOverride !== undefined ? referrerOverride : req.headers.referer || req.headers.referrer,
        ipHash: req.ipHash,
    };
}

function logClick(doc) {
    JobClickV2.create(doc).catch((err) => {
        console.error("[ClickV2] Failed to log click event:", err.message);
    });
}

function incrStat(jobId, field) {
    JobV2.updateOne({ _id: jobId }, { $inc: { [field]: 1 } }).catch((err) => {
        console.error(`[ClickV2] Failed to increment ${field}:`, err.message);
    });
}

/**
 * GET /api/jobs/:slug/apply — Log apply click and redirect to applyLink
 */
exports.applyRedirect = async (req, res) => {
    try {
        const job = await JobV2.findOne({
            slug: req.params.slug,
            status: "published",
            deletedAt: null,
        })
            .select("_id applyLink")
            .lean();

        if (!job) {
            return res.status(404).json({ error: "Job not found" });
        }

        logClick(buildClickDoc(job._id, "apply_click", req));
        incrStat(job._id, "stats.applyClicks");

        return res.redirect(302, job.applyLink);
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};

/**
 * POST /api/jobs/:slug/view — Log detail view
 */
exports.logView = async (req, res) => {
    try {
        const job = await JobV2.findOne({
            slug: req.params.slug,
            status: "published",
            deletedAt: null,
        })
            .select("_id")
            .lean();

        if (!job) {
            return res.status(404).json({ error: "Job not found" });
        }

        const referrer = req.body && typeof req.body.referrer === "string" ? req.body.referrer : undefined;
        logClick(buildClickDoc(job._id, "detail_view", req, referrer));
        incrStat(job._id, "stats.pageViews");

        return res.status(200).json({ success: true });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};
