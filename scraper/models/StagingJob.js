const mongoose = require("mongoose");

const stagingJobSchema = new mongoose.Schema(
    {
        status: {
            type: String,
            enum: ["pending", "approved", "rejected"],
            default: "pending",
            index: true,
        },
        scrapedAt: { type: Date, default: Date.now },
        source: String,
        sourceUrl: String,
        companyPageUrl: String,
        fingerprint: { type: String, unique: true },
        jobData: {
            title: String,
            link: String,
            jdpage: String,
            salary: String,
            batch: String,
            degree: String,
            jobdesc: String,
            eligibility: String,
            experience: String,
            lastdate: String,
            skills: String,
            location: String,
            responsibility: String,
            jobtype: String,
            imagePath: { type: String, default: "none" },
            companytype: String,
            aboutCompany: String,
            role: String,
            jdbanner: String,
            companyName: String,
            platform: { type: String, default: "careerspage" },
            tags: { type: [String], default: [] },
            skilltags: { type: [String], default: [] },
            salaryRange: {
                from: Number,
                to: Number,
            },
            workMode: {
                type: String,
                enum: ["onsite", "hybrid", "remote"],
                default: "onsite",
            },
            isActive: { type: Boolean, default: true },
            jobId: String,
            isFeaturedJob: { type: Boolean, default: false },
            company: { type: mongoose.Schema.Types.ObjectId, ref: "CompanyLogo" },
            benefits: String,
            priority: { type: Number, default: 1, min: 0 },
            expiresAt: Date,
            source: String,
            postedBy: String,
            isVerified: { type: Boolean, default: false },
            stipend: Number,
            category: {
                type: String,
                enum: ["engineering", "design", "product", "data", "devops", "qa", "management", "other"],
            },
        },
        rejectedReason: String,
        approvedAt: Date,
        aiProvider: String,
    },
    { timestamps: true }
);

stagingJobSchema.index({ scrapedAt: -1 });

const StagingJob = mongoose.model("StagingJob", stagingJobSchema);

module.exports = StagingJob;
