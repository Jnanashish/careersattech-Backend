const mongoose = require("mongoose");

const AdPosterSchema = new mongoose.Schema({
    link:{
        type : String,
    },
    imagePath:{
        type : String,
    },
    totalclick:{
        type : Number,
        default: 0,
    },
},{ timestamps: true })

const ads = mongoose.model('AdsPoster', AdPosterSchema);

module.exports = ads;
