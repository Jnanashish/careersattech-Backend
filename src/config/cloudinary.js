const cloudinary = require("cloudinary").v2;
const config = require("./index");

cloudinary.config({
    cloud_name: config.cloudinary.cloudName,
    api_key: config.cloudinary.apiKey,
    api_secret: config.cloudinary.apiSecret,
});

let adsCloudinary = null;
if (config.cloudinaryAds.cloudName && config.cloudinaryAds.apiKey && config.cloudinaryAds.apiSecret) {
    adsCloudinary = require("cloudinary").v2;
}

module.exports = {
    main: cloudinary,
    adsConfig: config.cloudinaryAds,
};
