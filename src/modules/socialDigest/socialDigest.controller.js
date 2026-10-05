const { runSocialDigest } = require("../../services/socialDigest");

/**
 * GET /api/admin/social-digest/preview?count=
 * What the digest would send right now. Sends and stamps nothing.
 */
exports.previewSocialDigest = async (req, res, next) => {
    try {
        const { count } = req.validatedQuery;
        const result = await runSocialDigest({ trigger: "preview", dryRun: true, count });
        return res.status(200).json({ data: result });
    } catch (err) {
        return next(err);
    }
};

/**
 * POST /api/admin/social-digest/send   body: { count? }
 * Send the digest to Telegram now — same selection and messages as the 16:00
 * cron, capped at `count` jobs. Sent jobs are stamped, so the next cron run
 * picks different ones. `data.sent === false` with reason "no-eligible-jobs"
 * is a normal 200.
 */
exports.sendSocialDigest = async (req, res, next) => {
    try {
        const { count } = req.validated;
        const result = await runSocialDigest({ trigger: "manual", count });
        if (result.reason === "already-running") {
            return res.status(409).json({ error: "A digest is already being sent" });
        }
        if (result.reason === "telegram-failed") {
            return res.status(502).json({
                error: "Telegram refused the digest. No job was marked as sent.",
            });
        }
        return res.status(200).json({ data: result });
    } catch (err) {
        return next(err);
    }
};
