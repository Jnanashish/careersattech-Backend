// import the models
const jd = require("../model/jobdetailsSchema");
require("dotenv").config();
const { apiErrorHandler, jobDetailsHandler } = require("../Helpers/controllerHelper");

// to store image files cloudinary config
const cloudinary = require("cloudinary").v2;
cloudinary.config({
    cloud_name: process.env.CLOUD_NAME,
    api_key: process.env.API_KEY,
    api_secret: process.env.API_SECRET,
    secure: true,
});

// get job details based on various query parameters
exports.getJobs = (req, res) => {
    // get all the query params
    const { page, size, companyname, batch, degree, jobtype, query, location, id } = req.query;

    let conditions = {};
    let options = {};

    // check if id is present and return job details for it
    if (!!id) {
        jd.findOne({ _id: id }).exec(sendResponse);
        return;
    }

    // check for companyname
    if (!!companyname) {
        conditions.companyName = { $regex: companyname, $options: "i" };
    }

    // check for batch or year
    if (!!batch) {
        conditions.batch = { $regex: batch, $options: "i" };
    }

    // check for degree
    if (!!degree) {
        conditions.degree = { $regex: degree, $options: "i" };
    }

    // check for jobtype like internship or full time
    if (!!jobtype) {
        conditions.jobtype = { $regex: jobtype, $options: "i" };
    }

    // if user search any query including company name then search for it in title
    // if any word of query is present in title then return the result
    if (!!query) {
        const queryArray = query.split(' ');
        const queryConditions = queryArray.map(word => ({ title: { $regex: word, $options: "i" } }));
        conditions.$or = queryConditions;
    }

    // check for location
    if (!!location) {
        conditions.location = { $regex: location, $options: "i" };
    }

    // check for page and size
    if (!!page && !!size) {
        const limit = parseInt(size);
        const skip = (parseInt(page) - 1) * parseInt(size);
        options.limit = limit;
        options.skip = skip;
    }

    jd.find(conditions).sort({ _id: -1 }).limit(options.limit).skip(options.skip).exec(sendResponse);

    function sendResponse(err, result) {
        if (err) {
            return apiErrorHandler(err, res);
        }
        if (id || !page || !size) {
            return res.status(200).send(result);
        }
        return jobDetailsHandler(result, res);
    }
};

// -----------------------------------------------------------
// delete job details based on id
exports.deleteJobById = (req, res) => {
    jd.deleteOne({ _id: req.params.id }).exec((err, res) => {
        if (err) {
            return apiErrorHandler(err, res);
        }
        return res.status(200).json({
            message: "Deleted Successfully",
        });
    });
};

// -----------------------------------------------------------
// update the click count of a particular job (by id)
exports.updateClick = async (req, res) => {
    try {
        const updatedJob = await jd.findByIdAndUpdate(
            { _id: req.params.id },
            { $inc: { totalclick: 1 }},
            { new: true }
        );

        if (!updatedJob) {
            return res.status(404).json({
                error: "Job not found",
            });
        }

        return res.status(200).json({
            message: "Clicked",
        });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};

// -----------------------------------------------------------
// update the existing data of a particular job (by id)
exports.updateJob = async (req, res) => {
    try {
        const { title, link, salary, batch, role, degree, jobdesc, eligibility, experience, lastdate, skills, location, responsibility, jobtype, imagePath, totalclick, aboutCompany, companyName } = req.body;

        const updatedJob = await jd.findOneAndUpdate(
            { _id: req.params.id },
            {
                $set: {
                    title,
                    link,
                    salary,
                    batch,
                    role,
                    degree,
                    jobdesc,
                    eligibility,
                    experience,
                    lastdate,
                    skills,
                    location,
                    responsibility,
                    jobtype,
                    imagePath,
                    totalclick,
                    aboutCompany,
                    companyName
                },
            }
        );

        if (!updatedJob) {
            return res.status(404).json({
                error: "Job not found",
            });
        }

        return res.status(200).json({
            message: "Successfully Updated",
        });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};

// -----------------------------------------------------------
// add new job data
exports.addJobs = async (req, res) => {
    const {
        title,
        link,
        jdpage,
        salary,
        batch,
        degree,
        jobdesc,
        eligibility,
        experience,
        lastdate,
        skills,
        role,
        location,
        responsibility,
        jobtype,
        companytype,
        aboutCompany,
        jdbanner,
        companyName,
        imagePath,
    } = req.body;

    try {
        let data = new jd({
            title,
            link,
            jdpage,
            salary,
            batch,
            degree,
            jobdesc,
            eligibility,
            experience,
            lastdate,
            skills,
            role,
            location,
            responsibility,
            jobtype,
            companytype,
            aboutCompany,
            jdbanner,
            companyName,
            imagePath,
        });

        if (!!req?.files) {
            const file = req.files?.photo;
            const result = await cloudinary.uploader.upload(file.tempFilePath);
            data.imagePath = result.secure_url;
        }

        await data.save();
        return res.status(201).json({
            message: "Data added successfully",
        });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};
