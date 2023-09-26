const companyLogo = require("../model/CompanyLogoSchema")

exports.getCompanyLogo = (req, res) => {
    const { companyname } = req.query;

    companyLogo.find({ $or: [{ title: { $regex: companyname, $options: "i" } }] })
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
    const data = new companyLogo({smallLogo, largeLogo, companyName})

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
    companyLogo.findOneAndUpdate(
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