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
        return res.status(200).json({
            message: "Data added successfully",
            id: newCompany?._id,
        });
    } catch (error) {
        return apiErrorHandler(error, res);
    }
};

// -----------------------------------------------------------
// get company details by id or company name return only one company details
exports.getCompanyDetails = async (req, res) => {
    const { id, companyname } = req.query;
    let query = {};

    if (!!id) {
        query = { _id: id };
    } else if (!!companyname) {
        query = { companyName: { $regex: escapeRegex(companyname), $options: "i" } };
    }

    try {
        const result = await companyDetails
            .find(query)
            .populate({ path: "listedJobs" })
            .sort({ _id: -1 });
        return res.status(200).send(result || {});
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
        await companyDetails.findOneAndUpdate({ _id: req.params.id }, { $set: updateData });
        return res.status(200).json({ message: "Company details updated successfully" });
    } catch (err) {
        console.error("Company API error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
};

exports.deleteCompanyDetails = async (req, res) => {
    try {
        await companyDetails.deleteOne({ _id: req.params.id });
        return res.status(200).json({ message: "Deleted Successfully" });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};
