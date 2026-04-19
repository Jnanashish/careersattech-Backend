const mongoose = require("mongoose");

// Normalize jdpage: admin UI sends a boolean toggle, but legacy callers
// (FormData, scraper payloads) may send strings or URLs. Treat anything that
// isn't explicitly "off" as on — i.e. show the JD page redirect.
function coerceJdpage(v) {
    if (v === true || v === false) return v;
    if (v === null || v === undefined) return undefined; // let schema default fill in
    const s = String(v).trim().toLowerCase();
    if (s === "" || s === "false" || s === "0" || s === "no") return false;
    return true;
}

// schema for job description
const jobdetailsSchema = new mongoose.Schema(
    {
        title: { type: String, required: true },
        link: { type: String, required: true },
        jdpage: { type: Boolean, default: true, set: coerceJdpage },
        salary: { type: String },
        batch: { type: String },
        degree: { type: String },
        jobdesc: { type: String },

        eligibility: { type: String },
        experience: { type: String },
        lastdate: { type: String }, // application deadline
        skills: { type: String }, // array of skills tag
        location: { type: String },
        responsibility: { type: String },

        // fulltime or intern role
        jobtype: { type: String },
        imagePath: {
            // logo image path
            type: String,
            default: "none",
        },
        companytype: {
            // type of company (service / product / startup)
            type: String,
        },
        totalclick: {
            type: Number, //total no of apply clicked
            default: 0,
        },
        adclick: {
            type: Number,
            default: 0,
        },
        aboutCompany: {
            type: String,
        },
        role: { type: String },
        jdbanner: {
            type: String, // banner of the job post
        },
        companyName: { type: String },
        platform: {
            // platform where redirection url will land, careerspage, linkedin, cuvette
            type: String,
            default: "careerspage",
        },
        tags: {
            type: [String],
            default: [],
        },
        skilltags: {
            type: [String],
            default: [],
        },
        salaryRange: {
            from: Number,
            to: Number,
        },
        workMode: {
            type: String,
            enum: ["onsite", "hybrid", "remote"],
            default: "onsite",
        },
        isActive: { type: Boolean, default: true }, // wheather job is currently active or not
        jobId: { type: String }, // id mentioned in company careers page
        isFeaturedJob: { type: Boolean, default: false },
        company: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "CompanyLogo",
        },
        benefits: { type: String },
        priority: {
            type: Number,
            default: 1,
            min: 0,
        },
        expiresAt: { type: Date },
        source: { type: String },
        postedBy: { type: String },
        isVerified: { type: Boolean, default: false },
        stipend: { type: Number },
        category: {
            type: String,
            enum: ["engineering", "design", "product", "data", "devops", "qa", "management", "other"],
        },
    },
    { timestamps: true }
);

jobdetailsSchema.index({ companyName: 1 });
jobdetailsSchema.index({ batch: 1 });
jobdetailsSchema.index({ degree: 1 });
jobdetailsSchema.index({ jobtype: 1 });
jobdetailsSchema.index({ location: 1 });
jobdetailsSchema.index({ isActive: 1 });
jobdetailsSchema.index({ priority: -1, _id: -1 });

const Jobdesc = mongoose.model("Jobdesc", jobdetailsSchema);

module.exports = Jobdesc;
