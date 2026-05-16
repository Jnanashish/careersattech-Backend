require("dotenv").config();
const mongoose = require("mongoose");
const JobV2 = require("../../src/modules/jobsV2/jobsV2.model");

(async () => {
    await mongoose.connect(process.env.DATABASE);
    const slug = "unitedhealth-group-associate-aiml-engineer-84s7zu";
    const job = await JobV2.findOne({ slug }).lean();
    if (!job) {
        console.log("NOT FOUND");
    } else {
        console.log({
            _id: job._id,
            slug: job.slug,
            status: job.status,
            datePosted: job.datePosted,
            validThrough: job.validThrough,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
            publishedAt: job.publishedAt,
            "stats.pageViews": job.stats?.pageViews,
            "stats.applyClicks": job.stats?.applyClicks,
            source: job.source,
            deletedAt: job.deletedAt,
        });
    }
    await mongoose.disconnect();
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
