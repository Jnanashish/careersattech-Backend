// import the models
const fs = require("fs");
const Jobdesc = require("../model/jobs.schema");
const CompanyLogo = require("../model/company.schema");
const JobClickEvent = require("../model/jobClickEvent.schema");
const { apiErrorHandler, jobDetailsHandler, escapeRegex } = require("../Helpers/controllerHelper");

// to store image files cloudinary config
const cloudinary = require("cloudinary").v2;
cloudinary.config({
    cloud_name: process.env.CLOUD_NAME,
    api_key: process.env.API_KEY,
    api_secret: process.env.API_SECRET,
    secure: true,
});

// get job details based on various query parameters
exports.getJobs = async (req, res) => {
    // get all the query params
    // by default data will be filtered (filterData = 1)
    const { page, size, companyname, batch, degree, jobtype, query, location, id, jobId, priority, filterData = 1 } = req.query;

    let conditions = {};
    let sort = { _id: -1 };

    // check if id is present and return job details for it
    if (!!id) {
        try {
            const result = await Jobdesc.findOne({ _id: id }).populate({
                path: "company",
                select: "smallLogo largeLogo companyName companyInfo companyType",
            });
            return jobDetailsHandler(result, res, conditions);
        } catch (err) {
            return apiErrorHandler(err, res);
        }
    }

    if (!!companyname) {
        conditions.companyName = { $regex: escapeRegex(companyname), $options: "i" };
    }

    if (!!batch) {
        conditions.batch = { $regex: escapeRegex(batch), $options: "i" };
    }

    if (!!degree) {
        conditions.degree = { $regex: escapeRegex(degree), $options: "i" };
    }

    if (!!jobtype) {
        conditions.jobtype = { $regex: escapeRegex(jobtype), $options: "i" };
    }

    if (!!jobId) {
        conditions.jobId = { $regex: escapeRegex(jobId), $options: "i" };
    }

    if (!!query) {
        const queryArray = query.split(" ");
        const queryConditions = queryArray.map((word) => ({ title: { $regex: escapeRegex(word), $options: "i" } }));
        conditions.$or = queryConditions;
    }

    if (!!location) {
        conditions.location = { $regex: escapeRegex(location), $options: "i" };
    }

    if (!!priority) {
        sort = { priority: -1, _id: -1 };
    }

    try {
        let dbQuery = Jobdesc.find(conditions)
            .populate({
                path: "company",
                select: "smallLogo largeLogo companyName companyInfo companyType",
            })
            .sort(sort);

        if (!!page && !!size) {
            const limit = Math.min(Math.max(parseInt(size) || 20, 1), 100);
            const pageNum = Math.max(parseInt(page) || 1, 1);
            const skip = (pageNum - 1) * limit;
            dbQuery = dbQuery.limit(limit).skip(skip);
        }

        const result = await dbQuery;

        // when page and size not present
        if (!page || !size) {
            return jobDetailsHandler(result, res, conditions);
        }
        return jobDetailsHandler(result, res, conditions, parseInt(filterData));
    } catch (err) {
        return apiErrorHandler(err, res);
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

        // Insert timestamped click event (fire-and-forget)
        JobClickEvent.create({
            jobId: req.params.id,
            source: req.body.source || "apply_button",
        }).catch((err) => console.error("Failed to log click event:", err));

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

        const allowedFields = [
            "title", "link", "jdpage", "salary", "batch", "degree", "jobdesc",
            "eligibility", "experience", "lastdate", "skills", "location",
            "responsibility", "jobtype", "imagePath", "companytype", "aboutCompany",
            "role", "jdbanner", "companyName", "platform", "skilltags", "salaryRange",
            "workMode", "isActive", "jobId", "isFeaturedJob", "benefits", "priority",
            "expiresAt", "source", "postedBy", "isVerified", "stipend", "category",
        ];
        const updateData = {};
        for (const field of allowedFields) {
            if (req.body[field] !== undefined) updateData[field] = req.body[field];
        }
        if (tagsArray) updateData.tags = tagsArray;
        if (companyId) updateData.company = companyId;

        const updatedJob = await Jobdesc.findOneAndUpdate(
            { _id: req.params.id },
            { $set: updateData }
        );

        if (!updatedJob) {
            return res.status(404).json({
                error: "Job not found",
            });
        }

        if (companyId) {
            await CompanyLogo.updateOne(
                { _id: companyId },
                { $addToSet: { listedJobs: req.params.id } }
            );
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

        const allowedFields = [
            "title", "link", "jdpage", "salary", "batch", "degree", "jobdesc",
            "eligibility", "experience", "lastdate", "skills", "location",
            "responsibility", "jobtype", "imagePath", "companytype", "aboutCompany",
            "role", "jdbanner", "companyName", "platform", "skilltags", "salaryRange",
            "workMode", "isActive", "jobId", "isFeaturedJob", "benefits", "priority",
            "expiresAt", "source", "postedBy", "isVerified", "stipend", "category",
        ];
        const jobData = {};
        for (const field of allowedFields) {
            if (req.body[field] !== undefined) jobData[field] = req.body[field];
        }
        if (tagsArray) jobData.tags = tagsArray;
        if (companyId) jobData.company = companyId;

        let job = new Jobdesc(jobData);

        if (req?.files?.photo) {
            const file = req.files.photo;
            const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];
            if (!allowedTypes.includes(file.mimetype)) {
                return res.status(400).json({ error: "Invalid file type. Allowed: jpeg, png, webp, svg" });
            }
            const result = await cloudinary.uploader.upload(file.tempFilePath);
            fs.unlink(file.tempFilePath, () => {});
            job.imagePath = result.secure_url;
        }

        if (companyId) {
            await CompanyLogo.updateOne(
                { _id: companyId },
                { $addToSet: { listedJobs: job._id } }
            );
        }

        await job.save();
        return res.status(201).json({
            message: "Data added successfully",
        });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};
