const companyDetails = require("../model/companydetailsSchema")

exports.getCompanyLogo = (req, res) => {
    const { companyName } = req.query;

    companyDetails.find({ $or: [{ companyName: { $regex: companyName, $options: "i" } }] })
    .sort({ _id: -1 })
    .exec((err, result) => {
        if (err) {
            return res.status(500).json({
                error: err.message,
                
            });
        }
        var data = {
            data: result.map((value) => {
                const { id, smallLogo, largeLogo, companyName} = value;
                return { id, smallLogo, largeLogo, companyName };
            }),
        };
        return res.status(200).send(data);        
    }) 
}

exports.addCompanyLogo = (req, res) => {
    const {smallLogo, largeLogo, companyName} = req.body;
    const data = new companyDetails({smallLogo, largeLogo, companyName})

    data.save((err, result) => {
        if (err) {
            return res.status(500).json({
                error: err.message,
            });
        }
        return res.status(201).json({
            message: "Data added successfully",
        });
    });    
}

exports.updateCompanyLogo = (req, res) => {
    const {smallLogo, largeLogo, companyName} = req.body;
    companyDetails.findOneAndUpdate(
        { _id: req.params.id },
        {
            $set: {
                smallLogo,
                largeLogo,
                companyName,
            }
        }
    ).exec((err, result) => {
        if (err) {
            return res.status(500).json({
                error: err.message,
            });
        }
        return res.status(200).json({
            message: "Successfully Updated",
        });
    });
}   



// ------------------------------------------------------------------
// get all the company details

// add company details
exports.addCompanyDetails = (req, res) => {
    const { companyLogo, companyBanner, companyInfo, listedJobs, companyType, careerPageLink, linkedinPageLink, isPromoted, companyName } = req.body;

    const newCompany = new companyDetails({
        companyLogo,
        companyBanner,
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

// get company details by id or company name
exports.getCompanyDetails = (req, res) => {
    const { id, companyname } = req.query;
    let query = {};

    if (!!id) {
        query = { _id: id };
    } else if (!!companyname) {
        query = { companyName: { $regex: companyname, $options: "i" } };
    }

    companyDetails.findOne(query).exec((err, result) => {
        if (err) {
            return res.status(500).json({
                error: err.message,
            });
        }
        if (!!result) {
            return res.status(200).send(result);
        } else {
            return res.status(404).json({
                error: "Company not found",
            });
        }
    });
};

// get company logo only
exports.getCompanyLogo = (req, res) => {
    const companyName = req.query.companyName;
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
                const { id, companyLogo, companyBanner, companyName } = result;
                var data = {
                    data: { id, companyLogo, companyBanner, companyName },
                };
                return res.status(200).send(data);
            } else {
                return res.status(404).json({
                    error: "Company not found",
                });
            }
        });
};

// update company details
exports.updateCompanyDetails = (req, res) => {
    const { companyLogo, companyBanner, companyInfo, listedJobs, companyType, careerPageLink, linkedinPageLink, isPromoted, companyName } = req.body;

    const companyId = req.params.id; // Assuming the company id is passed as a query parameter

    companyDetails.findOneAndUpdate(
        { _id: companyId },
        {
            companyLogo,
            companyBanner,
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
