const { runSocialDigest } = require("../../services/socialDigest");

/**
 * GET /api/admin/social-digest/preview
 * What the digest would send right now. Sends and stamps nothing.
 */
exports.previewSocialDigest = async (req, res, next) => {
    try {
        const result = await runSocialDigest({ trigger: "preview", dryRun: true });
        return res.status(200).json({ data: result });
    } catch (err) {
        return next(err);
    }
};

/**
 * POST /api/admin/social-digest/send
 * Send the digest to Telegram now — same selection and messages as the 16:00
 * cron. Sent jobs are stamped, so the next cron run picks different ones.
 * `data.sent === false` with reason "no-eligible-jobs" is a normal 200.
 */
exports.sendSocialDigest = async (req, res, next) => {
    try {
        const result = await runSocialDigest({ trigger: "manual" });
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
