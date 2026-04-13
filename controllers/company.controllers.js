const mongoose = require("mongoose");
const companyDetails = require("../model/company.schema");
const { apiErrorHandler, escapeRegex } = require("../Helpers/controllerHelper");

// add company details (POST)
exports.addCompanyDetails = async (req, res) => {
    const allowedFields = [
        "companyName", "smallLogo", "largeLogo", "companyInfo",
        "companyType", "careerPageLink", "linkedinPageLink", "isPromoted",
    ];
    const companyData = {};
    for (const field of allowedFields) {
        if (req.body[field] !== undefined) companyData[field] = req.body[field];
    }
    const newCompany = new companyDetails(companyData);

    try {
        await newCompany.save();
        return res.status(201).json({
            message: "Data added successfully",
            id: newCompany?._id,
        });
    } catch (error) {
        return apiErrorHandler(error, res);
    }
};

// -----------------------------------------------------------
// get company details by id, company name, or paginated list
exports.getCompanyDetails = async (req, res) => {
    const { id, companyname, search, page, limit } = req.query;
    let query = {};

    if (!!id) {
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: "Invalid company ID" });
        }
        query = { _id: id };
    } else if (companyname || search) {
        const term = companyname || search;
        query = { companyName: { $regex: escapeRegex(term), $options: "i" } };
    }

    try {
        const pageNum = Math.max(parseInt(page) || 1, 1);
        const pageSize = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
        const skip = (pageNum - 1) * pageSize;

        const [result, totalCount] = await Promise.all([
            companyDetails
                .find(query)
                .populate({ path: "listedJobs" })
                .sort({ _id: -1 })
                .skip(skip)
                .limit(pageSize),
            companyDetails.countDocuments(query),
        ]);

        const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
        return res.status(200).json({
            data: result,
            pagination: {
                currentPage: pageNum,
                totalPages,
                totalCount,
                pageSize,
            },
        });
    } catch (err) {
        console.error("Company API error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
};

// -----------------------------------------------------------
// get company logo only based on queried companyname
exports.getCompanyLogo = async (req, res) => {
    const { id, companyname } = req.query;
    let query = {};

    if (!!id) {
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: "Invalid company ID" });
        }
        query = { _id: id };
    } else if (!!companyname) {
        query = { companyName: { $regex: escapeRegex(companyname), $options: "i" } };
    }

    try {
        const result = await companyDetails.findOne(query).sort({ _id: -1 });
        if (!!result) {
            const { id, smallLogo, largeLogo, companyName } = result;
            return res.status(200).send({
                data: { id, smallLogo, largeLogo, companyName },
            });
        } else {
            return res.status(404).json({ error: "Company not found" });
        }
    } catch (err) {
        console.error("Company API error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
};

// -----------------------------------------------------------
// update company details
exports.updateCompanyDetails = async (req, res) => {
    try {
        const allowedFields = [
            "companyName", "smallLogo", "largeLogo", "companyInfo",
            "companyType", "careerPageLink", "linkedinPageLink", "isPromoted",
        ];
        const updateData = {};
        for (const field of allowedFields) {
            if (req.body[field] !== undefined) updateData[field] = req.body[field];
        }
        const result = await companyDetails.findOneAndUpdate({ _id: req.params.id }, { $set: updateData });
        if (!result) {
            return res.status(404).json({ error: "Company not found" });
        }
        return res.status(200).json({ message: "Company details updated successfully" });
    } catch (err) {
        console.error("Company API error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
};

exports.deleteCompanyDetails = async (req, res) => {
    try {
        const result = await companyDetails.deleteOne({ _id: req.params.id });
        if (result.deletedCount === 0) {
            return res.status(404).json({ error: "Company not found" });
        }
        return res.status(200).json({ message: "Deleted Successfully" });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};
