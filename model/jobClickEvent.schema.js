const mongoose = require("mongoose");

const jobClickEventSchema = new mongoose.Schema({
    jobId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Jobdesc",
        required: true,
        index: true,
    },
    source: {
        type: String,
        default: "apply_button",
    },
    timestamp: {
        type: Date,
        default: Date.now,
        index: true,
    },
});

// Compound index for time-range queries grouped by job
jobClickEventSchema.index({ timestamp: 1, jobId: 1 });

const JobClickEvent = mongoose.model("JobClickEvent", jobClickEventSchema);

module.exports = JobClickEvent;
