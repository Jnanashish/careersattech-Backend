const express = require("express");
const router = express.Router();

const requireAuth = require("../../middleware/auth");
const validateObjectId = require("../../middleware/validateObjectId");

// import methods from controllers
const { getJobs, addJobs, updateClick, updateJob, deleteJobById } = require("./jobs.controller");
const { getPosterLink } = require("./common.controller");

router.get("/jd/get", getJobs);
router.post("/jd/add", requireAuth, addJobs);

router.delete("/jd/delete/:id", requireAuth, validateObjectId, deleteJobById);
router.put("/jd/update/:id", requireAuth, validateObjectId, updateJob);
router.patch("/jd/update/count/:id", validateObjectId, updateClick);
router.post("/jd/getposterlink", requireAuth, getPosterLink);

module.exports = router;
