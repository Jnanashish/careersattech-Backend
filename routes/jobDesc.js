const express = require("express");
const router = express.Router();
const cors = require("cors");

// import methods from controllers
const {getJobs, getJobsBatch, getJobsDegree, getJobsType, getJobById, deleteJobById, updateJob, updateClick, addJobs, getAllJobs, getJdcompanyname, getPosterLink} = require("../controllers/jobDesc")

//allow cors
router.use(cors({
    origin: true,
    methods : ["GET", "POST", "PUT", "PATCH", "DELETE"] , 
}))



// get all the available jobs
router.get("/jd/get", getJobs);
router.get("/jd/get/all", getAllJobs);
router.get("/jd/get/batch", getJobsBatch);
router.get("/jd/get/degree", getJobsDegree);
router.get("/jd/get/jobtype", getJobsType);
router.get("/jd/get/companyname", getJdcompanyname);

// get job based on id
router.get("/jd/get/:id", getJobById);

// delete job based on id
router.delete("/jd/delete/:id", deleteJobById);

// update job based on id
router.put("/jd/update/:id", updateJob);

// update the totalclick once every time api called
router.patch("/jd/update/count/:id", updateClick);

// update the totalclick once every time api called
router.post("/jd/add", addJobs);

router.post("/jd/getposterlink", getPosterLink);


module.exports = router;