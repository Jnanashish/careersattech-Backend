// import the models
const adlink = require("../model/AdLinkSchema");

// get all the ads
exports.getAds = (req, res) => {
    adlink
        .find()
        .sort({ _id: -1 })
        .exec((err, result) => {
            if (err) {
                return res.status(500).json({
                    error: err.message,
                });
            }
            return res.status(200).send(result);
        });
};

// delete only one item with id
exports.deleteAds = (req, res) => {
    adlink.deleteOne({ _id: req.params.id }).exec((err, result) => {
        if (err) {
            return res.status(500).json({
                error: err.message,
            });
        }
        return res.status(200).json({
            message: "Deleted Successfully",
        });
    });
};

// add data to database
exports.addAds = (req, res) => {
    const { link, title, order, paragraph } = req.body;
    const data = new adlink({
        link,
        title,
        order,
        paragraph,
    });
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
};

// update the totalclick once every time api called
exports.updateClick = (req, res) => {
    adlink
        .findByIdAndUpdate(
            { _id: req.params.id },
            {
                $inc: { totalclick: 1 },
            },
            {
                new: true,
            }
        )
        .exec((err, result) => {
            if (err) {
                return res.status(500).json({
                    error: err.message,
                });
            }
            return res.status(200).json({
                message: "Clicked",
            });
        });
};
