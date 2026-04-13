const fs = require("fs");
const path = require("path");
const cloudinary = require("cloudinary").v2;
const axios = require("axios");
const sharp = require("sharp");
const { encode } = require("blurhash");
const { v4: uuidv4 } = require("uuid");

// Blog images use the same Cloudinary account, uploaded to a blog/ folder
cloudinary.config({
    cloud_name: process.env.CLOUD_NAME,
    api_key: process.env.API_KEY,
    api_secret: process.env.API_SECRET,
    secure: true,
});

const FOLDER = process.env.BLOG_CLOUDINARY_FOLDER || "blog";
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/svg+xml", "image/gif"];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Compute blurhash from an image file.
 */
async function computeBlurhash(filePath) {
    const { data, info } = await sharp(filePath)
        .raw()
        .ensureAlpha()
        .resize(32, 32, { fit: "inside" })
        .toBuffer({ resolveWithObject: true });

    return encode(new Uint8ClampedArray(data), info.width, info.height, 4, 3);
}

/**
 * Upload a local image file to Cloudinary with WebP conversion + blurhash.
 *
 * @param {string} filePath - Path to the temp file
 * @param {object} [options]
 * @param {string} [options.folder] - Cloudinary subfolder
 * @returns {Promise<{url: string, width: number, height: number, publicId: string, blurhash: string}>}
 */
async function uploadImage(filePath, options = {}) {
    const folder = options.folder || FOLDER;

    const [uploadResult, blurhash] = await Promise.all([
        cloudinary.uploader.upload(filePath, {
            folder,
            format: "webp",
            quality: "auto",
            resource_type: "image",
        }),
        computeBlurhash(filePath),
    ]);

    // Clean up temp file
    fs.unlink(filePath, (err) => {
        if (err) console.error("[Cloudinary] Failed to delete temp file:", err.message);
    });

    return {
        url: uploadResult.secure_url,
        width: uploadResult.width,
        height: uploadResult.height,
        publicId: uploadResult.public_id,
        blurhash,
    };
}

/**
 * Download an external image URL and re-upload to Cloudinary.
 *
 * @param {string} externalUrl - The external image URL
 * @returns {Promise<{url: string, width: number, height: number}>}
 */
async function downloadAndReupload(externalUrl) {
    const tmpFile = path.join("/tmp", `blog-${uuidv4()}`);
    try {
        const response = await axios.get(externalUrl, {
            responseType: "arraybuffer",
            timeout: 15000,
            maxContentLength: MAX_SIZE,
        });

        fs.writeFileSync(tmpFile, response.data);

        const result = await cloudinary.uploader.upload(tmpFile, {
            folder: FOLDER,
            format: "webp",
            quality: "auto",
            resource_type: "image",
        });

        return {
            url: result.secure_url,
            width: result.width,
            height: result.height,
        };
    } finally {
        if (fs.existsSync(tmpFile)) {
            fs.unlinkSync(tmpFile);
        }
    }
}

module.exports = {
    uploadImage,
    downloadAndReupload,
    computeBlurhash,
    ALLOWED_TYPES,
    MAX_SIZE,
};
