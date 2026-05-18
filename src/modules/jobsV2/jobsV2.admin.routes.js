const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();

const requireAuth = require("../../middleware/auth");
const validateObjectId = require("../../middleware/validateObjectId");

const {
    createJobV2,
    listJobsV2,
    getJobV2,
    updateJobV2,
    deleteJobV2,
} = require("./jobsV2.controller");

const {
    createJobV2Schema,
    updateJobV2Schema,
    listJobV2QuerySchema,
    validate,
    validateQuery,
} = require("./jobsV2.validators");

const { scrapeAndPost, scrapeAndPostSchema } = require("./jobsV2.scrape.controller");

const scrapeAndPostLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) =>
        (req.firebaseUser && req.firebaseUser.uid) || req.ip,
    message: { error: "Too many scrape requests, please slow down" },
});

router.post("/admin/jobs/v2", requireAuth, validate(createJobV2Schema), createJobV2);
router.get("/admin/jobs/v2", requireAuth, validateQuery(listJobV2QuerySchema), listJobsV2);
router.get("/admin/jobs/v2/:id", requireAuth, validateObjectId, getJobV2);
router.patch("/admin/jobs/v2/:id", requireAuth, validateObjectId, validate(updateJobV2Schema), updateJobV2);
router.delete("/admin/jobs/v2/:id", requireAuth, validateObjectId, deleteJobV2);

router.post(
    "/admin/jobs/scrape-and-post",
    requireAuth,
    scrapeAndPostLimiter,
    validate(scrapeAndPostSchema),
    scrapeAndPost
);

module.exports = router;
