const express = require("express");
const router = express.Router();
const requireAuth = require("../middleware/auth");
const {
    getSummary,
    getJobsOverTime,
    getClicksOverTime,
    getTopJobs,
    getJobsByCategory,
} = require("../controllers/analytics.controllers");

router.use("/analytics", requireAuth);

router.get("/analytics/summary", getSummary);
router.get("/analytics/jobs-over-time", getJobsOverTime);
router.get("/analytics/clicks-over-time", getClicksOverTime);
router.get("/analytics/top-jobs", getTopJobs);
router.get("/analytics/jobs-by-category", getJobsByCategory);

module.exports = router;
