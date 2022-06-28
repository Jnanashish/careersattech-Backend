const mongoose = require("mongoose");

const AdLinkImgSchema = new mongoose.Schema({
    link:{
        type : String,
    },
    title:{
        type : String,
    },
    para:{
       type : String, 
    },
    totalclick:{
        type : Number,
        default: 0,
    },
    imagePath:{
        type : String,
    },
    order:{
        type : Number,
        default: 10,
    },
},{ timestamps: true })

const adlinkimg = mongoose.model('AdLinkImg', AdLinkImgSchema);

module.exports = adlinkimg;
