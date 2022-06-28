const mongoose = require("mongoose");

const ShowAdPopSchema = new mongoose.Schema({
    adpoptype:{
        type : String,
        default : 'none'
    },
})

const ShowAdPop = mongoose.model('ShowAdPop', ShowAdPopSchema);
module.exports = ShowAdPop;
