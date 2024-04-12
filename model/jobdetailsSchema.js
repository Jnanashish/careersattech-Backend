const mongoose = require("mongoose");

// schema for job description
const jobdetailsSchema = new mongoose.Schema(
    {
        title: {
            type: String,
        },
        link: {
            type: String,
        },
        jdpage: {
            type: String,
        },
        salary: {
            type: String,
        },
        batch: {
            type: String,
        },
        degree: {
            type: String,
        },
        jobdesc: {
            type: String,
        },
        eligibility: {
            type: String,
        },
        experience: {
            type: String,
        },
        lastdate: {
            type: String,
        },
        skills: {
            type : String,
        },
        location: {
            type: String,
        },
        responsibility: {
            type: String,
        },
        // fulltime or intern role
        jobtype: {
            type: String,
        },
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
        role: {
            type: String,
        },
        jdbanner: {
            type: String, // banner of the job post
        },
        companyName: {
            type: String,
        },
        platform: { // platform from where redirection url will land
            type: String,
            default: "careerspage",
        },
        tags : {
            type : [String],
            default : [],
        },
        skilltags : {
            type : [String],
            default : [],
        }
    },
    { timestamps: true }
);

const jd = mongoose.model("Jobdesc", jobdetailsSchema);

module.exports = jd;
