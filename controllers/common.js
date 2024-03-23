const cloudinary2 = require("cloudinary").v2;
cloudinary2.config({
    cloud_name: process.env.CLOUD_NAME2,
    api_key: process.env.API_KEY2,
    api_secret: process.env.API_SECRET2,
    secure: true,
});

// upload any image and get the cloudinary image link
exports.getPosterLink = (req, res) => {
    const file = req.files.photo;
    cloudinary2.uploader.upload(file.tempFilePath, (err, result) => {
        if (err) {
            return res.status(500).json({
                error: err.message,
            });
        }
        return res.status(201).json({
            url: result.secure_url,
        });
    });
};
