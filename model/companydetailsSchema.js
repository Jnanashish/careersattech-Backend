const mongoose = require("mongoose");

const companydetailsSchema = new mongoose.Schema({
    companyName: {
        type: String,
    },
    // company logo
    smallLogo: {
        type: String,
    },
    // company big logo for banner
    largeLogo: {
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
    },
});

const companyLogo = mongoose.model("CompanyLogo", companydetailsSchema);
module.exports = companyLogo;
