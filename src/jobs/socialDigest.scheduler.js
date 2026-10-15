const cron = require("node-cron");
const logger = require("../utils/logger");
const { runSocialDigest, DIGEST_TIMEZONE } = require("../services/socialDigest");
const { notifyGeneralError } = require("../utils/telegram");

// Hardcoded on purpose — no env flag gates or tunes this cron.
const CRON_SCHEDULE = "0 16 * * *"; // once a day at 16:00 IST

/**
 * Daily social digest — the top best-to-post jobs plus an Instagram caption and
 * a WhatsApp message, posted to the socialDigest Telegram channel.
 *
 * Always scheduled, like the cleanup cron. Every server process that is up at
 * 16:00 posts, so a dev server left running against the shared database posts
 * to the channel and stamps jobs as sent too.
 */
function init() {
    logger.info(`[digest] scheduling cron "${CRON_SCHEDULE}" (tz=${DIGEST_TIMEZONE})`);

    cron.schedule(
        CRON_SCHEDULE,
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
        { timezone: DIGEST_TIMEZONE }
    );
}

module.exports = { init, CRON_SCHEDULE };
