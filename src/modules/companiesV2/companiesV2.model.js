const mongoose = require("mongoose");

const companyV2Schema = new mongoose.Schema(
  {
    // ─── Identity (required) ───────────────────────────────
    companyName: { type: String, required: true, trim: true },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      index: true,
    },

    // ─── Branding (optional) ───────────────────────────────
    logo: {
      icon: { type: String },
      banner: { type: String },
      iconAlt: { type: String },
      bgColor: { type: String },
    },

    // ─── Content (optional) ────────────────────────────────
    description: {
      short: { type: String },
      long: { type: String },
    },

    // ─── Classification (optional) ─────────────────────────
    companyType: {
      type: String,
      enum: [
        "product",
        "service",
        "startup",
        "mnc",
        "consulting",
        "unicorn",
        "bigtech",
        "other",
        null,
      ],
      default: null,
      index: true,
    },
    industry: { type: String, index: true },
    tags: { type: [String], default: [], index: true },
    techStack: { type: [String], default: [] },

    // ─── Location (optional) ───────────────────────────────
    headquarters: { type: String },
    locations: { type: [String], default: [] },

    // ─── Meta (optional) ───────────────────────────────────
    foundedYear: {
      type: Number,
      min: 1800,
      max: new Date().getFullYear(),
    },
    employeeCount: {
      type: String,
      enum: [
        "1-10",
        "11-50",
        "51-200",
        "201-500",
        "501-1000",
        "1001-5000",
        "5000+",
        null,
      ],
      default: null,
    },
    website: { type: String },

    // ─── External links (optional) ─────────────────────────
    careerPageLink: { type: String },
    socialLinks: {
      linkedin: { type: String },
      twitter: { type: String },
      instagram: { type: String },
      glassdoor: { type: String },
    },

    // ─── Ratings (optional) ────────────────────────────────
    ratings: {
      glassdoor: { type: Number, min: 0, max: 5 },
      ambitionBox: { type: Number, min: 0, max: 5 },
    },

    // ─── Denormalized stats (optional cache) ───────────────
    stats: {
      openJobsCount: { type: Number, default: 0 },
      totalJobsEverPosted: { type: Number, default: 0 },
    },

    // ─── Lifecycle ─────────────────────────────────────────
    status: {
      type: String,
      enum: ["active", "inactive", "archived"],
      default: "active",
      required: true,
      index: true,
    },
    isVerified: { type: Boolean, default: false },
    sponsorship: {
      tier: {
        type: String,
        enum: ["none", "featured", "sponsored"],
        default: "none",
      },
      activeUntil: { type: Date },
    },

    // ─── SEO (optional) ────────────────────────────────────
    seo: {
      metaTitle: { type: String },
      metaDescription: { type: String },
      ogImage: { type: String },
    },

    // ─── Soft delete ───────────────────────────────────────
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// ─── Indexes ─────────────────────────────────────────────────
companyV2Schema.index(
  { companyName: 1 },
  {
    unique: true,
    collation: { locale: "en", strength: 2 },
  }
);
companyV2Schema.index({ industry: 1, status: 1 });
companyV2Schema.index({ companyType: 1, status: 1 });
companyV2Schema.index({ "sponsorship.tier": -1, companyName: 1 });

module.exports =
  mongoose.models.CompanyV2 ||
  mongoose.model("CompanyV2", companyV2Schema, "companies_v2");
