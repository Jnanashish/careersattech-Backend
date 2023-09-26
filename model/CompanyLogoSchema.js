import mongoose from "mongoose";

const companyLogoSchema = new mongoose.Schema({
    companyName : {
        type : String,
    },
    smallLogo : {
        type : String,
    },
    largeLogo : {
        type : String,
    }
})

const companyLogo = mongoose.model('CompanyLogo', companyLogoSchema);
module.exports = companyLogo;