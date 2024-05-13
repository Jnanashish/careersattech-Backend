const companyDetails = require("../model/company.schema");
const { apiErrorHandler } = require("../Helpers/controllerHelper");

// add company details (POST)
exports.addCompanyDetails = async (req, res) => {
    const newCompany = new companyDetails({ ...req.body });

    try {
        await newCompany.save();
        return res.status(200).json({
            message: "Data added successfully",
        });
    } catch (error) {
        return apiErrorHandler(err, res);
    }
};

// -----------------------------------------------------------
// get company details by id or company name return only one company details
exports.getCompanyDetails = (req, res) => {
    const { id, companyname } = req.query;
    let query = {};

    if (!!id) {
        query = { _id: id };
    }
    if (!!companyname) {
        query = { companyName: { $regex: companyname, $options: "i" } };
    }

    companyDetails
        .find(query)
        .populate({
            path : "listedJobs",
        })
        .sort({ _id: -1 })
        .exec((err, result) => {
            if (err) {
                return res.status(500).json({
                    error: err.message,
                });
            }
            const data = result || {};
            return res.status(200).send(data);
        });
};

// -----------------------------------------------------------
// get company logo only based on queried companyname
exports.getCompanyLogo = (req, res) => {
    const { id, companyname } = req.query;
    let query = {};

    if (!!id) {
        query = { _id: id };
    }
    if (!!companyname) {
        query = { companyName: { $regex: companyname, $options: "i" } };
    }

    companyDetails
        .findOne(query)
        .sort({ _id: -1 })
        .exec((err, result) => {
            if (err) {
                return res.status(500).json({
                    error: err.message,
                });
            }
            if (!!result) {
                const { id, smallLogo, largeLogo, companyName } = result;
                var data = {
                    data: { id, smallLogo, largeLogo, companyName },
                };
                return res.status(200).send(data);
            } else {
                return res.status(404).json({
                    error: "Company not found",
                });
            }
        });
};

// -----------------------------------------------------------
// update company details
exports.updateCompanyDetails = (req, res) => {
    const companyId = req.params.id; // assuming the company id is passed as a query parameter

    companyDetails.findOneAndUpdate(
        { _id: companyId },
        { ...req.body },
        (err) => {
            if (err) {
                return res.status(500).json({
                    error: err.message,
                });
            }
            return res.status(200).json({
                message: "Company details updated successfully",
            });
        }
    );
};

exports.deleteCompanyDetails = (req, res) => {
    companyDetails.deleteOne({ _id: req.params.id }).exec((err) => {
        if (err) {
            return apiErrorHandler(err, res);
        }
        return res.status(200).json({
            message: "Deleted Successfully",
        });
    });
};
