const cloudinary2 = require("cloudinary").v2;
cloudinary2.config({
    cloud_name: process.env.CLOUD_NAME2,
    api_key: process.env.API_KEY2,
    api_secret: process.env.API_SECRET2,
    secure: true,
});
const companycareerspagedata = require("../Data/companycareerpage");
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

exports.addNewkey = (req, res) => {
    // console.log("companycareerspagedata", companycareerspagedata);
    const comp = companycareerspagedata?.map((company) => {
        console.log("company", company);
        company["newKey"] = "";
        return company;
    });
    console.log("comp", comp);
    const fs = require("fs");
    fs.writeFileSync("como.json", JSON.stringify(comp, null, 2));
};
// exports.addNewkey();

exports.generatePhoto = (req, res) => {
    const imageUrl = ``;
    const img = "https://career-pages.vercel.app/_next/image?url=%2Flogo-cache%2Fwww.toptal.com.png&w=48&q=75";

    cloudinary2.uploader.upload(img, (err, result) => {
        if (err) {
            console.log("ERROR", err);
        }
    });
};

exports.generatePhoto();
