// import the models
const adbanner = require("../model/AdPosterScheme");

require("dotenv").config();

// to store image files
const cloudinary = require('cloudinary').v2;
cloudinary.config({ 
  cloud_name: process.env.CLOUD_NAME2, 
  api_key: process.env.API_KEY2, 
  api_secret: process.env.API_SECRET2,
  secure: true
});


// get all the ads
exports.getAds = (req, res) => {
    adbanner.find().sort({_id:-1})
    .exec((err, result) => {
        if(err){
            return res.status(500).json({
               error : err.message
            })           
        }
        return res.status(200).send(result);
    }) 
}



// delete only one item with id
exports.deleteAds = (req, res) => {
    adbanner.deleteOne({_id: req.params.id})
    .exec((err, result) => {
        if(err){
            return res.status(500).json({
                error : err.message
            })           
        }
        return res.status(200).json({
            message: "Deleted Successfully"
        })
   })    
}



// add data to database
exports.addAds = (req, res) => {
    const file = req.files.photo;
    const {link} = req.body;
    cloudinary.uploader.upload(file.tempFilePath, (err, result) => {
        const data = new adbanner({
            link, 
            imagePath:result.secure_url
        });
        data.save((err, result) => {
            if(err){
                return res.status(500).json({
                    error : err.message
                })           
            }  
            return res.status(201).json({
                message : "Data added successfully"
            }) 
        }) 
    })
}



// update the totalclick once every time api called
exports.updateClick = (req, res) => {
    adbanner.findByIdAndUpdate({ _id: req.params.id},{
        $inc: {"totalclick": 1}          
    },{
        new: true
    }).exec((err, result) => {
        if(err){
            return res.status(500).json({
                error : err.message
            })           
        }
        return res.status(200).json({
            message: "Clicked"
        })
    })    
}