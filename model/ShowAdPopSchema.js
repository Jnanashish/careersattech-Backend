const mongoose = require("mongoose");

const ShowAdPopSchema = new mongoose.Schema({
    // type of ads poped (email, none, ad)
    adpoptype:{
        type : String,
        default : 'none'
    },
})

const ShowAdPop = mongoose.model('ShowAdPop', ShowAdPopSchema);
module.exports = ShowAdPop;
