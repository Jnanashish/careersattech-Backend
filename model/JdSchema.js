const mongoose = require("mongoose");

const jdSchema = new mongoose.Schema({
    title:{
        type : String,
    },
    link:{
        type : String,
    },
    jdpage:{
        type : String,
    },    
    salary:{
        type : String,
    },
    batch:{
        type : String,
    },
    degree:{
        type : String,
    },
    jobdesc:{
        type : String,
    },
    eligibility:{
        type : String,
    },
    experience:{
        type : String,
    },
    lastdate:{
        type : String,
    },
    skills:{
        type : String,
    },
    location:{
        type : String,
    },
    responsibility:{
        type : String,
    },
    jobtype:{
        type : String,
    },
    imagePath:{
        type : String,
        default : 'none',
    },
    companytype:{
        type : String,
    },
    totalclick:{
        type : Number,
        default: 0,
    },
    adclick:{
        type : Number,
        default: 0,
    },
    aboutCompany:{
        type : String,
    },
    role:{
        type : String,
    },
    jdbanner:{
        type : String,
    },
},{ timestamps: true })

const jd = mongoose.model('Jobdesc', jdSchema);

module.exports = jd;
