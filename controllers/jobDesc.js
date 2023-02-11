// import the models
const jd = require("../model/JdSchema");
require("dotenv").config();

// to store image files cloudinary config
const cloudinary = require('cloudinary').v2;
cloudinary.config({ 
  cloud_name: process.env.CLOUD_NAME, 
  api_key: process.env.API_KEY, 
  api_secret: process.env.API_SECRET,
  secure: true
});

const cloudinary2 = require('cloudinary').v2;
cloudinary2.config({ 
  cloud_name: process.env.CLOUD_NAME2, 
  api_key: process.env.API_KEY2, 
  api_secret: process.env.API_SECRET2,
  secure: true
});

// get all the jobs with mandatory page and size
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
            // return only some required fields
            'data': result.map((value) => {
                const {
                    id,
                    title,
                    link,
                    batch,
                    degree,
                    jobtype,
                    imagePath,
                    jdpage,
                    createdAt,
                    location,
                    experience,
                    totalclick,
                } = value;
                return {
                    id,
                    title,
                    link,
                    batch,
                    degree,
                    jobtype,
                    imagePath,
                    jdpage,
                    createdAt,
                    location,
                    experience,
                    totalclick,
                };
            })
        };
        return res.status(200).send(data);
    })
}


// get all jobs along with all details no limit
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


// get job desc with name of the company
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
                const {
                    id,
                    title,
                    link,
                    batch,
                    degree,
                    jobtype,
                    imagePath,
                    jdpage,
                    createdAt,
                    location,
                    experience,
                    totalclick,
                } = value;
                return {
                    id,
                    title,
                    link,
                    batch,
                    degree,
                    jobtype,
                    imagePath,
                    jdpage,
                    createdAt,
                    location,
                    experience,
                    totalclick,
                };
            })
        };
        return res.status(200).send(data);
   })
}

// get job desc with name of batch
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
                const {
                    id,
                    title,
                    link,
                    batch,
                    degree,
                    jobtype,
                    imagePath,
                    jdpage,
                    createdAt,
                    location,
                    experience,
                    totalclick,
                } = value;
                return {
                    id,
                    title,
                    link,
                    batch,
                    degree,
                    jobtype,
                    imagePath,
                    jdpage,
                    createdAt,
                    location,
                    experience,
                    totalclick,
                };
            })
        };
        return res.status(200).send(data);
   })
}


// get job desc with degree
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
                const {
                    id,
                    title,
                    link,
                    batch,
                    degree,
                    jobtype,
                    imagePath,
                    jdpage,
                    createdAt,
                    location,
                    experience,
                    totalclick,
                } = value;
                return {
                    id,
                    title,
                    link,
                    batch,
                    degree,
                    jobtype,
                    imagePath,
                    jdpage,
                    createdAt,
                    location,
                    experience,
                    totalclick,
                };
            })
        };
        return res.status(200).send(data);
   })
}


// get jobs with type (intern, full time)
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
                const {
                    id,
                    title,
                    link,
                    batch,
                    degree,
                    jobtype,
                    imagePath,
                    jdpage,
                    createdAt,
                    location,
                    experience,
                    totalclick,
                } = value;
                return {
                    id,
                    title,
                    link,
                    batch,
                    degree,
                    jobtype,
                    imagePath,
                    jdpage,
                    createdAt,
                    location,
                    experience,
                    totalclick,
                };
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


// return cloudinary image link
exports.getPosterLink = (req, res) => {
    const file = req.files.photo;
    cloudinary2.uploader.upload(file.tempFilePath, (err, result) => {
            if(err){
                return res.status(500).json({
                    error : err.message
                })           
            } 
            return res.status(201).json({
                url : result.secure_url
            })          
    })
}



// add new job data
exports.addJobs = (req, res) => {
    const {title, link, jdpage, salary, batch, degree, jobdesc, eligibility, experience, lastdate, skills, role, location, responsibility, jobtype, companytype, aboutCompany, jdbanner, companyName} = req.body;

    if(!req.files){
        const data = new jd({title, link, jdpage, salary, batch, degree, jobdesc, eligibility, experience, lastdate, skills, role, location, responsibility, jobtype, companytype, aboutCompany, jdbanner, companyName})
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
            const data = new jd({title, link, jdpage, salary, batch, degree, jobdesc, eligibility, experience, lastdate, skills, role, location, responsibility, jobtype, companytype, aboutCompany, jdbanner, companyName, imagePath: result.secure_url})
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