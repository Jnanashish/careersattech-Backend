const showadpop = require("../model/ShowAdPopSchema");
const { apiErrorHandler } = require("../../Helpers/controllerHelper");

// get current pop type
exports.getAdPop = (req, res) => {
    showadpop
        .find()
        .sort({ _id: -1 })
        .exec((err, result) => {
            if (err) {
                return apiErrorHandler(err, res);
            }
            return res.status(200).send(result);
        });
};

// update pop type
exports.updateAdPop = (req, res) => {
    const { adpoptype } = req.body;
    showadpop
        .findOneAndUpdate(
            { _id: req.params.id },
            {
                $set: {
                    adpoptype,
                },
            }
        )
        .exec((err, res) => {
            if (err) {
                return apiErrorHandler(err, res);
            }
            return res.status(200).json({
                message: "Successfully Updated",
            });
        });
};
