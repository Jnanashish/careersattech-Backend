// import the models
const Jobdesc = require("../model/jobs.schema");
const CompanyLogo = require("../model/company.schema");

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
    // by default data will be filtered (filterData = 1)
    const { page, size, companyname, batch, degree, jobtype, query, location, id, jobId, priority, filterData = 1 } = req.query;

    let conditions = {};
    let options = {};
    let sort = { _id: -1 };

    // check if id is present and return job details for it
    if (!!id) {
        Jobdesc.findOne({ _id: id })
            .populate({
                path: "company",
                select: "smallLogo largeLogo companyName companyInfo companyType",
            })
            .exec(sendResponse);
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

    // check for jobtype like internship or full time
    if (!!jobId) {
        conditions.jobId = { $regex: jobId, $options: "i" };
    }

    // if user search any query including company name then search for it in title
    // if any word of query is present in title then return the result
    if (!!query) {
        const queryArray = query.split(" ");
        const queryConditions = queryArray.map((word) => ({ title: { $regex: word, $options: "i" } }));
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
        // conditions.isActive = true
    }

    if (!!priority) {
        sort = { priority: -1, _id: -1 };
    }

    // find job details based on conditions
    Jobdesc.find(conditions)
        .populate({
            path: "company",
            select: "smallLogo largeLogo companyName companyInfo companyType",
        })
        .sort(sort)
        .limit(options.limit)
        .skip(options.skip)
        .exec(sendResponse);

    function sendResponse(err, result) {
        if (err) {
            return apiErrorHandler(err, res);
        }
        // when page and size not present 
        if (id || !page || !size) {
            return jobDetailsHandler(result, res, conditions);
        }
        return jobDetailsHandler(result, res, conditions, parseInt(filterData));
    }
};

// -----------------------------------------------------------
// delete job details based on id
exports.deleteJobById = async (req, res) => {
    try {
        const deletedJob = await Jobdesc.findByIdAndDelete(req.params.id);
        if (!deletedJob) {
            return res.status(404).json({
                error: "Job not found",
            });
        }
        // Remove the job id from the listed job field of company schema
        const company = await CompanyLogo.findById(deletedJob?.company);
        if (!!company) {
            company.listedJobs = company.listedJobs.filter((jobId) => jobId.toString() !== req.params.id);
            await company.save();
        }

        return res.status(200).json({
            message: "Deleted Successfully",
        });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};

// -----------------------------------------------------------
// update the click count of a particular job (by id)
exports.updateClick = async (req, res) => {
    try {
        const updatedJob = await Jobdesc.findByIdAndUpdate({ _id: req.params.id }, { $inc: { totalclick: 1 } }, { new: true });

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
    const { companyId, tags } = req.body;
    try {
        let tagsArray;
        if(!!tags){
            tagsArray = tags.split(',');
        }

        const updatedJob = await Jobdesc.findOneAndUpdate(
            { _id: req.params.id },
            {
                $set: { ...req.body, tags: tagsArray, company: companyId },
            }
        );

        if (!updatedJob) {
            return res.status(404).json({
                error: "Job not found",
            });
        }

        // add the job reference to company schema also
        const company = await CompanyLogo.findById(companyId);
        if (!!company && !company.listedJobs.includes(req.params.id)) {
            company.listedJobs.push(req.params.id);
            await company.save();
        }

        return res.status(200).json({
            message: "Successfully Updated",
        });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};

// -----------------------------------------------------------
// add new job data (POST)
exports.addJobs = async (req, res) => {
    const { companyId, tags } = req.body;
    try {
        let tagsArray;
        if(!!tags){
            tagsArray = tags.split(',');
        }

        let job = new Jobdesc({ ...req.body, tags: tagsArray, company: companyId });

        // if file is present in req then generate cdn image link
        if (!!req?.files) {
            const file = req.files?.photo;
            const result = await cloudinary.uploader.upload(file.tempFilePath);
            job.imagePath = result.secure_url;
        }

        // add the job reference to company schema also
        const company = await CompanyLogo.findById(companyId);
        if (!!company) {
            company?.listedJobs?.push(job._id);
            await company.save();
        }

        await job.save();
        return res.status(201).json({
            message: "Data added successfully",
        });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};
