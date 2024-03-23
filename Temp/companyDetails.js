const mongoose = require("mongoose");

const CompanyDetailsSchema = new mongoose.Schema({
    companyName: {
        type: String,
    },
    companyLogo: {
        type: String,
    },
    companyBanner: {
        type: String,
    },
    companyInfo: {
        type: String,
    },
    listedJobs: {
        type: Array,
        default: [],
    },
    companyType: {
        type: String,
    },
    careerPageLink: {
        type: String,
    },
    linkedinPageLink: {
        type: String,
    },
    isPromoted: {
        type: Boolean,
        default: false,
    }
}, { timestamps: true });

const companyDetails = mongoose.model('CompanyDetails', CompanyDetailsSchema);

module.exports = companyDetails;
