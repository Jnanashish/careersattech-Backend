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
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

jobClickV2Schema.index({ job: 1, timestamp: -1 });
jobClickV2Schema.index({ eventType: 1, timestamp: -1 });
jobClickV2Schema.index({ timestamp: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 });

module.exports = mongoose.models.JobClickV2 || mongoose.model("JobClickV2", jobClickV2Schema, "job_clicks_v2");
