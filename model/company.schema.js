const mongoose = require("mongoose");

const companydetailsSchema = new mongoose.Schema({
    companyName: {
        type: String,
        required: true,
    },
    // company logo (icon)
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
    listedJobs: [{ type: mongoose.Schema.Types.ObjectId, ref: "Jobdesc" }],
    companyType: {
        type: String,
        default: "productbased",
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

const CompanyLogo = mongoose.model("CompanyLogo", companydetailsSchema);
module.exports = CompanyLogo;
