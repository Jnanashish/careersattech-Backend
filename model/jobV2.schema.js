const mongoose = require("mongoose");

const jobV2Schema = new mongoose.Schema(
  {
    // ─── Identity (required) ───────────────────────────────
    title: { type: String, required: true, trim: true },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      index: true,
    },

    // ─── Company (required) ────────────────────────────────
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CompanyV2",
      required: true,
      index: true,
    },
    companyName: { type: String, required: true, trim: true },

    // ─── Display mode (required) ───────────────────────────
    displayMode: {
      type: String,
      enum: ["internal", "external_redirect"],
      default: "internal",
      required: true,
    },

    // ─── Apply link (required) ─────────────────────────────
    applyLink: { type: String, required: true },

    // ─── Employment type (required for Google for Jobs) ────
    employmentType: {
      type: [String],
      enum: ["FULL_TIME", "PART_TIME", "CONTRACTOR", "INTERN", "TEMPORARY"],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: "At least one employment type is required",
      },
    },

    // ─── Batch eligibility (required) ──────────────────────
    batch: {
      type: [Number],
      required: true,
      index: true,
      validate: [
        {
          validator: (v) => Array.isArray(v) && v.length > 0,
          message: "At least one batch year is required",
        },
        {
          validator: (v) =>
            v.every((y) => Number.isInteger(y) && y >= 2020 && y <= 2030),
          message: "Each batch year must be between 2020 and 2030",
        },
        {
          validator: (v) => new Set(v).size === v.length,
          message: "Batch years must be unique",
        },
      ],
    },

    // ─── Description (optional — required when displayMode is "internal") ───
    jobDescription: {
      html: { type: String },
      plain: { type: String },
    },

    // ─── Classification (optional) ─────────────────────────
    category: {
      type: String,
      enum: [
        "engineering",
        "design",
        "product",
        "data",
        "devops",
        "qa",
        "management",
        "other",
        null,
      ],
      default: null,
      index: true,
    },
    workMode: {
      type: String,
      enum: ["onsite", "hybrid", "remote", null],
      default: null,
      index: true,
    },

    // ─── Eligibility (optional) ────────────────────────────
    degree: { type: [String], default: [] },
    experience: {
      min: { type: Number, default: 0 },
      max: { type: Number, default: 2 },
    },

    // ─── Location (optional) ───────────────────────────────
    jobLocation: {
      type: [
        {
          _id: false,
          city: { type: String },
          region: { type: String, default: "" },
          country: { type: String, default: "IN" },
        },
      ],
      default: [],
    },

    // ─── Compensation (optional) ───────────────────────────
    baseSalary: {
      currency: { type: String, default: "INR" },
      min: { type: Number },
      max: { type: Number },
      unitText: {
        type: String,
        enum: ["HOUR", "DAY", "WEEK", "MONTH", "YEAR"],
        default: "YEAR",
      },
    },

    // ─── Skills & tags (optional) ──────────────────────────
    requiredSkills: { type: [String], default: [], index: true },
    preferredSkills: { type: [String], default: [] },
    topicTags: { type: [String], default: [], index: true },

    // ─── Apply platform (optional) ─────────────────────────
    applyPlatform: {
      type: String,
      enum: ["careerspage", "linkedin", "cuvette", "email", "other"],
      default: "careerspage",
    },

    // ─── Dates ─────────────────────────────────────────────
    datePosted: { type: Date, default: Date.now, index: true },
    validThrough: { type: Date, index: true },

    // ─── Lifecycle ─────────────────────────────────────────
    status: {
      type: String,
      enum: ["draft", "published", "paused", "expired", "archived"],
      default: "draft",
      required: true,
      index: true,
    },
    isVerified: { type: Boolean, default: false },

    // ─── Monetization (optional) ───────────────────────────
    sponsorship: {
      tier: {
        type: String,
        enum: ["none", "boosted", "featured", "sponsored"],
        default: "none",
      },
      activeUntil: { type: Date },
    },
    priority: { type: Number, default: 1, min: 0 },

    // ─── Analytics cache (optional) ────────────────────────
    stats: {
      applyClicks: { type: Number, default: 0 },
      pageViews: { type: Number, default: 0 },
    },

    // ─── Media (optional) ──────────────────────────────────
    jdBanner: { type: String },

    // ─── SEO (optional — auto-generated if empty) ──────────
    seo: {
      metaTitle: { type: String },
      metaDescription: { type: String },
      ogImage: { type: String },
    },

    // ─── Source tracking (optional) ────────────────────────
    source: {
      type: String,
      enum: ["manual", "scraped", "api", "recruiter_submitted"],
      default: "manual",
    },
    externalJobId: { type: String },
    postedBy: { type: String },

    // ─── Soft delete ───────────────────────────────────────
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// ─── Compound indexes ────────────────────────────────────────
jobV2Schema.index({ status: 1, datePosted: -1 });
jobV2Schema.index({ status: 1, batch: 1 });
jobV2Schema.index({ status: 1, employmentType: 1 });
jobV2Schema.index({ status: 1, workMode: 1 });
jobV2Schema.index({ company: 1, status: 1 });
jobV2Schema.index({ "sponsorship.tier": -1, priority: -1, datePosted: -1 });

// ─── Text search ─────────────────────────────────────────────
jobV2Schema.index({
  title: "text",
  companyName: "text",
  "jobDescription.plain": "text",
  requiredSkills: "text",
});

// ─── Conditional validation: internal displayMode requires JD html ───
jobV2Schema.pre("validate", function (next) {
  if (
    this.displayMode === "internal" &&
    (!this.jobDescription || !this.jobDescription.html)
  ) {
    this.invalidate(
      "jobDescription.html",
      "Job description is required when displayMode is 'internal'"
    );
  }
  next();
});

// ─── Pre-save: auto-generate plain description from html ─────
jobV2Schema.pre("save", function (next) {
  if (
    this.jobDescription &&
    this.isModified("jobDescription.html") &&
    this.jobDescription.html
  ) {
    this.jobDescription.plain = this.jobDescription.html
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  next();
});

module.exports =
  mongoose.models.JobV2 ||
  mongoose.model("JobV2", jobV2Schema, "jobs_v2");
