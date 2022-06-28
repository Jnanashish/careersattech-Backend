// import the models
const jd = require("../model/JdSchema");

require("dotenv").config();

// to store image files
const cloudinary = require('cloudinary').v2;
cloudinary.config({ 
  cloud_name: process.env.CLOUD_NAME, 
  api_key: process.env.API_KEY, 
  api_secret: process.env.API_SECRET,
  secure: true
});


// Get all the jobs
exports.getJobs = (req, res) =>{
    const {page, size} = req.query;
    const limit = parseInt(size);
    const skip = (parseInt(page) - 1) * parseInt(size);

   jd.find().sort({_id:-1}).limit(limit).skip(skip)
   .exec((err, result) => {
        if(err){
            return res.status(500).json({
                error : err.message
            })           
        }
        var data = {
            'data': result.map((value) => {
                const {id, title, link, batch, degree, jobtype, imagePath, jdpage, createdAt} = value
                return {
                    id, title, link, batch, degree, jobtype, imagePath, jdpage, createdAt 
                }
            })
        };
        return res.status(200).send(data);
   })
}


exports.getAllJobs = (req, res) => {
    jd.find().sort({_id:-1})
    .exec((err, result) => {
        if(err){
            return res.status(500).json({
                error : err.message
            })           
        }
        return res.status(200).send(result);
   })    
}


exports.getJdcompanyname = (req, res) =>{
    const {companyname} = req.query;

    jd.find({$or:[
       {"title":{"$regex": companyname, "$options": "i" }}
    ]})
    .sort({_id:-1})
    .exec((err, result) => {
        if(err){
            return res.status(500).json({
                error : err.message
            })           
        }
        var data = {
            'data': result.map((value) => {
                const {id, title, link, batch, degree, jobtype, imagePath, jdpage, createdAt} = value
                return {
                    id, title, link, batch, degree, jobtype, imagePath, jdpage, createdAt
                }
            })
        };
        return res.status(200).send(data);
   })
}


exports.getJobsBatch = (req, res) =>{
    const {year} = req.query;

   jd.find({$or:[
       {"batch":{"$regex": year, "$options": "i" }},
       {"batch":{"$regex": "any", "$options": "i" }},
       {"batch":{"$regex": "N/A", "$options": "i" }},
       {"batch":{"$regex": "N", "$options": "i" }}
    ]})
    .sort({_id:-1})
    .exec((err, result) => {
        if(err){
            return res.status(500).json({
                error : err.message
            })           
        }
        var data = {
            'data': result.map((value) => {
                const {id, title, link, batch, degree, jobtype, imagePath, jdpage, createdAt} = value
                return {
                    id, title, link, batch, degree, jobtype, imagePath, jdpage, createdAt
                }
            })
        };
        return res.status(200).send(data);
   })
}


exports.getJobsDegree = (req, res) =>{
    const {degree} = req.query;

    jd.find({$or:[
       {"degree":{"$regex":degree, "$options": "i" }},
       {"degree":{"$regex":"N", "$options": "i" }},
       {"degree":{"$regex":"any", "$options": "i" }}
    ]})
    .sort({_id:-1})
    .exec((err, result) => {
        if(err){
            return res.status(500).json({
                error : err.message
            })           
        }
        var data = {
            'data': result.map((value) => {
                const {id, title, link, batch, degree, jobtype, imagePath, jdpage, createdAt} = value
                return {
                    id, title, link, batch, degree, jobtype, imagePath, jdpage, createdAt
                }
            })
        };
        return res.status(200).send(data);
   })
}


exports.getJobsType = (req, res) =>{
    const {jobtype} = req.query;

    jd.find({$or:[
       {"degree":{"$regex":jobtype, "$options": "i" }},
       {"degree":{"$regex":"N", "$options": "i" }}
    ]})
    .sort({_id:-1})
    .exec((err, result) => {
        if(err){
            return res.status(500).json({
                error : err.message
            })           
        }
        var data = {
            'data': result.map((value) => {
                const {id, title, link, batch, degree, jobtype, imagePath, jdpage, createdAt} = value
                return {
                    id, title, link, batch, degree, jobtype, imagePath, jdpage, createdAt
                }
            })
        };
        return res.status(200).send(data);
   })
}

// get a job based on id
exports.getJobById = (req, res) => {
    jd.findOne({ _id: req.params.id})
    .exec((err, result) => {
        if(err){
            return res.status(500).json({
                error : err.message
            })           
        }
        return res.status(200).send(result);
   })
}

// delete job based on id
exports.deleteJobById = (req, res) => {
    jd.deleteOne({_id: req.params.id})
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

// Update the existing data
exports.updateJob = (req, res) => {
    const {title, link, salary, batch, role, degree, jobdesc, eligibility, experience, lastdate, skills, location, responsibility, jobtype, imagePath, totalclick, aboutCompany} = req.body;

    jd.findOneAndUpdate({_id: req.params.id}, {
        $set:{
            title, link, salary, batch, role, degree, jobdesc, eligibility, experience, lastdate, skills, location, responsibility, jobtype, imagePath, totalclick,  aboutCompany
        }
    })
    .exec((err, result) => {
        if(err){
            return res.status(500).json({
                error : err.message
            })           
        }
        return res.status(200).json({
            message: "Successfully Updated"
        })
   })
}

exports.updateClick = (req, res) => {
    jd.findByIdAndUpdate({ _id: req.params.id},{
        $inc: {"totalclick": 1}          
    }, {
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

exports.addJobs = (req, res) => {
    const {title, link, jdpage, salary, batch, degree, jobdesc, eligibility, experience, lastdate, skills, role, location, responsibility, jobtype, companytype, aboutCompany} = req.body;

    if(!req.files){
        const data = new jd({title, link, jdpage, salary, batch, degree, jobdesc, eligibility, experience, lastdate, skills, role, location, responsibility, jobtype, companytype, aboutCompany})
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
    } else {
        const file = req.files.photo;
        cloudinary.uploader.upload(file.tempFilePath, (err, result) => {
            const data = new jd({title, link, jdpage, salary, batch, degree, jobdesc, eligibility, experience, lastdate, skills, role, location, responsibility, jobtype, companytype, aboutCompany, imagePath: result.secure_url})
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
}