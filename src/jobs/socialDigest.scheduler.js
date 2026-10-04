const cron = require("node-cron");
const logger = require("../utils/logger");
const { runSocialDigest, getDigestTimezone } = require("../services/socialDigest");
const { notifyGeneralError } = require("../utils/telegram");

const DEFAULT_CRON = "0 16 * * *"; // once a day at 16:00 in SOCIAL_DIGEST_TZ

/**
 * Daily social digest — the top best-to-post jobs plus an Instagram caption and
 * a WhatsApp message, posted to the socialDigest Telegram channel.
 *
 * Opt-in like the cleanup cron: scheduled only when SOCIAL_DIGEST_ENABLED is
 * exactly "true", so a dev server running against the shared database never
 * posts to the channel or stamps jobs as sent.
 */
function init() {
    if (process.env.SOCIAL_DIGEST_ENABLED !== "true") {
        logger.info("[digest] SOCIAL_DIGEST_ENABLED is not 'true' — cron NOT scheduled");
        return;
    }
    const schedule = process.env.SOCIAL_DIGEST_CRON || DEFAULT_CRON;
    if (!cron.validate(schedule)) {
        logger.error(`[digest] invalid SOCIAL_DIGEST_CRON: "${schedule}" — cron NOT scheduled`);
        return;
    }
    const timezone = getDigestTimezone();
    logger.info(`[digest] scheduling cron "${schedule}" (tz=${timezone})`);

    cron.schedule(
        schedule,
        async () => {
            try {
                const result = await runSocialDigest({ trigger: "cron" });
                // A refusal on the digest channel itself (the bot is not an
                // admin there, say) still reaches the general channel.
                if (result.reason === "telegram-failed") {
                    await notifyGeneralError(
                        "socialDigest cron",
                        new Error(
                            "Telegram refused the social digest; its jobs stay unsent for the next run. " +
                                "Check that the bot is an admin of the socialDigest channel."
                        )
                    );
                }
            } catch (err) {
                logger.error(`[digest] cron run failed: ${err.stack || err.message}`);
                await notifyGeneralError("socialDigest cron", err);
            }
        },
        { timezone }
    );
}

module.exports = { init, DEFAULT_CRON };
