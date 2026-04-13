const cron = require("node-cron");
const axios = require("axios");
const Blog = require("./blog.schema");

/**
 * Every minute, flip scheduled → published when scheduledFor ≤ now.
 */
function init() {
    cron.schedule("* * * * *", async () => {
        try {
            const now = new Date();

            // Find posts to publish (need slugs for revalidation)
            const toPublish = await Blog.find({
                status: "scheduled",
                scheduledFor: { $lte: now },
            }).select("slug publishedAt");

            if (toPublish.length === 0) return;

            // Update all matching posts
            await Blog.updateMany(
                { _id: { $in: toPublish.map((p) => p._id) } },
                [
                    {
                        $set: {
                            status: "published",
                            // Set publishedAt only if not already set
                            publishedAt: {
                                $cond: [{ $ifNull: ["$publishedAt", false] }, "$publishedAt", now],
                            },
                        },
                    },
                ]
            );

            console.log(`[BlogScheduler] Published ${toPublish.length} scheduled post(s)`);

            // Trigger revalidation for each published post
            const url = process.env.NEXT_REVALIDATION_URL || process.env.SITE_REVALIDATE_URL;
            const secret = process.env.REVALIDATE_SECRET;
            if (url && secret) {
                const paths = ["/blog", ...toPublish.map((p) => `/blog/${p.slug}`)];
                axios.post(url, { secret, paths }).catch((err) => {
                    console.error("[BlogScheduler] Revalidation failed:", err.message);
                });
            }
        } catch (err) {
            console.error("[BlogScheduler] Error:", err.message);
        }
    });

    console.log("[BlogScheduler] Cron active — checking every minute for scheduled posts");
}

module.exports = { init };
