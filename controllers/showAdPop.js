const showadpop = require("../model/ShowAdPopSchema");


exports.getAdPop = (req, res) => {
    showadpop.find().sort({_id:-1})
    .exec((err, result) => {
        if(err){
            return res.status(500).json({
               error : err.message
            })           
        }
        return res.status(200).send(result);
    }) 
}

exports.updateAdPop = (req, res) => {
    const {adpoptype} = req.body;
    showadpop.findOneAndUpdate({_id: req.params.id}, {
        $set:{
            adpoptype
        }
    }).exec((err, result) => {
        if(err){
            return res.status(500).json({
               error : err.message
            })           
        }
        return res.status(200).json({
               message : "Successfully Updated"
        })           
    }) 
}
