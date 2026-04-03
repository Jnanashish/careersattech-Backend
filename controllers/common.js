const fs = require("fs");
const cloudinary2 = require("cloudinary").v2;
cloudinary2.config({
    cloud_name: process.env.CLOUD_NAME2,
    api_key: process.env.API_KEY2,
    api_secret: process.env.API_SECRET2,
    secure: true,
});
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];

exports.getPosterLink = async (req, res) => {
    try {
        if (!req.files || !req.files.photo) {
            return res.status(400).json({ error: "No image file provided" });
        }
        const file = req.files.photo;
        if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
            return res.status(400).json({ error: "Invalid file type. Allowed: jpeg, png, webp, svg" });
        }
        const result = await cloudinary2.uploader.upload(file.tempFilePath);
        fs.unlink(file.tempFilePath, () => {});
        return res.status(201).json({
            url: result.secure_url,
        });
    } catch (err) {
        console.error("getPosterLink error:", err);
        return res.status(500).json({ error: "Failed to upload image" });
    }
};
