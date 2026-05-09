const mongoose = require("mongoose");

// ─── Sub-schemas mirroring JobV2 / CompanyV2 ──────────────────────
// kept loose (no enum enforcement here) — the transformer normalizes
// values, and final enum validation happens when we create the real
// JobV2 / CompanyV2 documents at approval time.

const jobDataSchema = new mongoose.Schema(
    {
        title: String,
        applyLink: String,
        displayMode: { type: String, default: "internal" },
        employmentType: { type: [String], default: ["FULL_TIME"] },
        batch: { type: [Number], default: [] },

        jobDescription: {
            html: String,
            plain: String,
        },

        category: String,
        workMode: String,

        degree: { type: [String], default: [] },
        experience: {
            min: { type: Number, default: 0 },
            max: { type: Number, default: 2 },
        },

        jobLocation: {
            type: [
                {
                    _id: false,
                    city: String,
                    region: { type: String, default: "" },
                    country: { type: String, default: "IN" },
                },
            ],
            default: [],
        },

        baseSalary: {
            currency: { type: String, default: "INR" },
            min: Number,
            max: Number,
            unitText: { type: String, default: "YEAR" },
        },

        requiredSkills: { type: [String], default: [] },
        preferredSkills: { type: [String], default: [] },
        topicTags: { type: [String], default: [] },

        applyPlatform: { type: String, default: "careerspage" },

        datePosted: Date,
        validThrough: Date,

        externalJobId: String,

        // populated at ingest time when the company is matched in CompanyV2
        company: { type: mongoose.Schema.Types.ObjectId, ref: "CompanyV2" },
        companyName: String,
    },
    { _id: false }
);

const companyDataSchema = new mongoose.Schema(
    {
        companyName: String,

        description: {
            short: String,
            long: String,
        },

        companyType: String,
        industry: String,
        tags: { type: [String], default: [] },
        techStack: { type: [String], default: [] },

        headquarters: String,
        locations: { type: [String], default: [] },

        foundedYear: Number,
        employeeCount: String,

        website: String,
        careerPageLink: String,

        socialLinks: {
            linkedin: String,
            twitter: String,
            instagram: String,
            glassdoor: String,
        },
    },
    { _id: false }
);

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

        jobData: { type: jobDataSchema, default: () => ({}) },
        companyData: { type: companyDataSchema, default: () => ({}) },

        // set once we successfully match an existing CompanyV2 at ingest
        matchedCompany: { type: mongoose.Schema.Types.ObjectId, ref: "CompanyV2", default: null },

        rejectedReason: String,
        approvedAt: Date,
        approvedJob: { type: mongoose.Schema.Types.ObjectId, ref: "JobV2" },
        aiProvider: String,
    },
    { timestamps: true }
);

stagingJobSchema.index({ scrapedAt: -1 });
stagingJobSchema.index({ "jobData.applyLink": 1 });
stagingJobSchema.index({ "jobData.externalJobId": 1 });

const StagingJob = mongoose.models.StagingJob || mongoose.model("StagingJob", stagingJobSchema);

module.exports = StagingJob;
