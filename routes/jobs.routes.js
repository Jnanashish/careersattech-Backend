const express = require("express");
const router = express.Router();
const cors = require("cors");

// import methods from controllers
const { getJobs, addJobs, updateClick, updateJob, deleteJobById } = require("../controllers/jobs.controllers");
const { getPosterLink } = require("../controllers/common");

//allow cors
router.use(
    cors({
        origin: true,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    })
);
router.options("*", cors());

router.get("/jd/get", getJobs); // get all the available jobs with query parameters
router.post("/jd/add", addJobs); // add new job details

router.delete("/jd/delete/:id", deleteJobById); // delete job based on id
router.put("/jd/update/:id", updateJob); // update a particular job based on id
router.patch("/jd/update/count/:id", updateClick); // update the click count of a job every time api called
router.post("/jd/getposterlink", getPosterLink); // get cloudinay link of any uploaded image

module.exports = router;
