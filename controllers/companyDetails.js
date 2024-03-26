const companyDetails = require("../model/companydetailsSchema");

// add company details
exports.addCompanyDetails = (req, res) => {
    const { smallLogo, largeLogo, companyInfo, listedJobs, companyType, careerPageLink, linkedinPageLink, isPromoted, companyName } = req.body;

    const newCompany = new companyDetails({
        smallLogo,
        largeLogo,
        companyInfo,
        listedJobs,
        companyType,
        careerPageLink,
        linkedinPageLink,
        isPromoted,
        companyName,
    });

    newCompany.save((err, res) => {
        if (err) {
            return res.status(500).json({
                error: err.message,
            });
        }
        return res.status(201).json({
            message: "Company details added successfully",
        });
    });
};

// -----------------------------------------------------------
// get company details by id or company name return only one company with the details
exports.getCompanyDetails = (req, res) => {
    const { id, companyname } = req.query;
    let query = {};

    if (!!id) {
        query = { _id: id };
    }
    if (!!companyname) {
        query = { companyName: { $regex: companyname, $options: "i" } };
    }

    if (Object.keys(query).length > 0) {
        companyDetails
            .findOne(query)
            .sort({ _id: -1 })
            .exec((err, result) => {
                if (err) {
                    return res.status(500).json({
                        error: err.message,
                    });
                }
                
                const data = result || {}
                return res.status(200).send(data);
            });
    } else {
        companyDetails
            .find()
            .sort({ _id: -1 })
            .exec((err, result) => {
                if (err) {
                    return res.status(500).json({
                        error: err.message,
                    });
                }
                const data = result || {}
                return res.status(200).send(data);
            });
    }
};

// -----------------------------------------------------------
// get company logo only based on queried companyname
exports.getCompanyLogo = (req, res) => {
    const companyName = req.query.companyname;
    companyDetails
        .findOne({ companyName: { $regex: companyName, $options: "i" } })
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
    const { smallLogo, largeLogo, companyInfo, listedJobs, companyType, careerPageLink, linkedinPageLink, isPromoted, companyName } = req.body;

    const companyId = req.params.id; // assuming the company id is passed as a query parameter

    companyDetails.findOneAndUpdate(
        { _id: companyId },
        {
            smallLogo,
            largeLogo,
            companyInfo,
            listedJobs,
            companyType,
            careerPageLink,
            linkedinPageLink,
            isPromoted,
            companyName,
        },
        (err, res) => {
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
