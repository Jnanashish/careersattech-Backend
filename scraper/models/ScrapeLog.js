const mongoose = require("mongoose");

const scrapeLogSchema = new mongoose.Schema(
    {
        runId: String,
        startedAt: Date,
        completedAt: Date,
        trigger: { type: String, enum: ["cron", "manual"] },
        aiProvider: String,
        adapters: [
            {
                name: String,
                status: { type: String, enum: ["success", "partial", "failed", "stopped"] },
                jobLinksFound: Number,
                jobsFetched: Number,
                jobsTransformed: Number,
                jobsIngested: Number,
                jobsSkipped: Number,
                errors: [
                    {
                        jobUrl: String,
                        step: { type: String, enum: ["fetch", "extract", "transform", "ingest"] },
                        message: String,
                    },
                ],
                durationMs: Number,
            },
        ],
        summary: {
            totalNew: Number,
            totalSkipped: Number,
            totalErrors: Number,
            adaptersSucceeded: [String],
            adaptersFailed: [String],
        },
    },
    { timestamps: true }
);

scrapeLogSchema.index({ startedAt: -1 });

const ScrapeLog = mongoose.model("ScrapeLog", scrapeLogSchema);

module.exports = ScrapeLog;
