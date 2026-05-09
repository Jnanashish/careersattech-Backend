const mongoose = require("mongoose");

const jobClickV2Schema = new mongoose.Schema(
    {
        job: { type: mongoose.Schema.Types.ObjectId, ref: "JobV2", required: true },
        eventType: {
            type: String,
            enum: ["impression", "detail_view", "apply_click", "external_redirect"],
            required: true,
        },
        sessionHash: { type: String },
        userAgent: { type: String },
        referrer: { type: String },
        ipHash: { type: String },
        // 30-minute bucket key derived from timestamp; used for de-dupe upsert
        bucket: { type: Number, index: true },
        timestamp: { type: Date, default: Date.now },
    },
    { timestamps: false }
);

jobClickV2Schema.index({ job: 1, timestamp: -1 });
jobClickV2Schema.index({ eventType: 1, timestamp: -1 });
jobClickV2Schema.index({ timestamp: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 });
// CAT-SEC-010: per-(session, job, event, 30min-bucket) unique to dedupe inflation
jobClickV2Schema.index(
    { sessionHash: 1, job: 1, eventType: 1, bucket: 1 },
    { unique: true, partialFilterExpression: { sessionHash: { $exists: true, $type: "string" } } }
);

module.exports = mongoose.models.JobClickV2 || mongoose.model("JobClickV2", jobClickV2Schema, "job_clicks_v2");
