const mongoose = require("mongoose");

const AdLinkSchema = new mongoose.Schema({
    link:{
        type : String,
    },
    title:{
        type : String,
    },
    totalclick:{
        type : Number,
        default: 0,
    },
    para:{
       type : String, 
    },
    order:{
        type : Number,
        default: 10,
    },
},{ timestamps: true })

const adlink = mongoose.model('Ad', AdLinkSchema);

module.exports = adlink;
