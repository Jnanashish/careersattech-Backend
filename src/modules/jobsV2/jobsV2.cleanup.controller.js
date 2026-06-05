const mongoose = require("mongoose");
const JobV2 = require("./jobsV2.model");
const { apiErrorHandler } = require("../../utils/controllerHelper");
const { runVerification } = require("../../jobs/verifyJobs.scheduler");
const verifyState = require("./jobsV2.verifyState");
const logger = require("../../utils/logger");

// Verification outcomes that put a job into the human-review queue. "expired"
// means the apply link is dead (404/410, expired-phrase, or redirect to a
// careers homepage) — the scan also moves those to status "archived". Anything
// the verifier can't confirm dead (timeout, 5xx, bot-wall/CAPTCHA, empty body)
// is treated as "active" and never flagged.
const FLAGGED_RESULTS = ["expired"];

const FLAGGED_PROJECTION =
    "title slug companyName applyLink status archivedAt archivedReason verification datePosted createdAt";

/**
 * Filter for jobs the verifier has flagged for review and that are not yet
 * deleted. This is the exact set that `purge { all: true }` removes, so the
 * list endpoint and the bulk-delete always agree on "what is flagged".
 *
 * @param {string} [result] optional narrowing to a single flagged result
 */
function buildFlaggedFilter(result) {
    const filter = { deletedAt: null };
    if (result && FLAGGED_RESULTS.includes(result)) {
        filter["verification.lastCheckResult"] = result;
    } else {
        filter["verification.lastCheckResult"] = { $in: FLAGGED_RESULTS };
    }
    return filter;
}

/**
 * POST /api/admin/jobs/v2/verify-now
 *
 * Kick off an apply-link verification scan over all published jobs in the
 * background and return 202 immediately. Expired links are auto-archived by the
 * scan; the resulting review queue is read via GET /flagged, and completion is
 * observed via GET /verify-now/status. Only one scan may run at a time.
 */
exports.triggerVerifyNow = async (req, res) => {
    if (verifyState.isRunning()) {
        return res.status(409).json({
            error: "A verification scan is already running",
            startedAt: verifyState.snapshot().startedAt,
        });
    }

    const { limit } = req.validated || {};

    verifyState.begin();

    const run = runVerification({
        trigger: "manual",
        limit: limit || null,
        skipEmail: true,
    })
        .then((summary) => {
            verifyState.finish(summary);
            logger.info(
                `[verify:api] scan complete checked=${summary.totalChecked} archived=${summary.expiredCount}`
            );
        })
        .catch((err) => {
            verifyState.finish(null);
            logger.error(`[verify:api] scan failed: ${err.stack || err.message}`);
        });

    verifyState.setCurrent(run);

    return res.status(202).json({
        message: "Verification scan started",
        status: "running",
        startedAt: verifyState.snapshot().startedAt,
    });
};

/**
 * GET /api/admin/jobs/v2/verify-now/status
 * Whether a scan is in flight, plus the last completed run's summary.
 */
exports.getVerifyStatus = async (req, res) => {
    return res.status(200).json(verifyState.snapshot());
};

/**
 * GET /api/admin/jobs/v2/flagged
 * Paginated review queue of jobs whose apply link is dead/expired.
 * Optional ?result=expired.
 */
exports.listFlaggedJobs = async (req, res) => {
    try {
        const { page = 1, limit = 20, result } = req.validatedQuery || {};
        const pageNum = Math.max(parseInt(page) || 1, 1);
        const pageSize = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
        const skip = (pageNum - 1) * pageSize;

        const filter = buildFlaggedFilter(result);

        const [jobs, total] = await Promise.all([
            JobV2.find(filter)
                .select(FLAGGED_PROJECTION)
                .sort({ "verification.lastCheckedAt": -1 })
                .skip(skip)
                .limit(pageSize)
                .lean(),
            JobV2.countDocuments(filter),
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
 * POST /api/admin/jobs/v2/flagged/purge
 *
 * Soft-delete jobs in bulk. Body must carry explicit intent:
 *   { ids: [..] }  → delete exactly those (skips any already deleted)
 *   { all: true }  → delete every currently-flagged job
 *
 * Soft delete = set deletedAt + status "archived" (reversible, and drops the
 * job out of every public and admin listing). Matches the single-job DELETE.
 */
exports.purgeFlaggedJobs = async (req, res) => {
    try {
        const { ids, all } = req.validated || {};

        let filter;
        if (Array.isArray(ids) && ids.length > 0) {
            filter = {
                _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) },
                deletedAt: null,
            };
        } else if (all) {
            filter = buildFlaggedFilter();
        } else {
            // Validator should have caught this; guard anyway so a bulk delete
            // never fires on an empty/unintended body.
            return res.status(400).json({
                error: "Provide a non-empty `ids` array or `all: true`",
            });
        }

        // Resolve the exact ids first so the response is an audit of what was
        // removed (updateMany alone can't tell us which docs it touched).
        const matched = await JobV2.find(filter).select("_id").lean();
        const matchedIds = matched.map((d) => d._id);

        if (matchedIds.length === 0) {
            return res.status(200).json({ deleted: 0, ids: [] });
        }

        const result = await JobV2.updateMany(
            { _id: { $in: matchedIds } },
            { $set: { deletedAt: new Date(), status: "archived" } }
        );

        logger.info(`[verify:api] purge soft-deleted ${result.modifiedCount} job(s)`);

        return res.status(200).json({
            deleted: result.modifiedCount,
            ids: matchedIds,
        });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};

exports._internals = { buildFlaggedFilter, FLAGGED_RESULTS };
