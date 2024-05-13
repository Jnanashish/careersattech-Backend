const mongoose = require("mongoose");

// schema for job description
const jobdetailsSchema = new mongoose.Schema(
    {
        title: { type: String, required: true },
        link: { type: String, required: true },
        jdpage: { type: String },
        salary: { type: String },
        batch: { type: String },
        degree: { type: String },
        jobdesc: { type: String },

        eligibility: { type: String },
        experience: { type: String },
        lastdate: { type: String }, // application deadline
        skills: [String], // array of skills tag
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
    },
    { timestamps: true }
);

const Jobdesc = mongoose.model("Jobdesc", jobdetailsSchema);

module.exports = Jobdesc;
