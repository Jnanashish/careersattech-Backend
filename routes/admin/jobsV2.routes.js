const express = require("express");
const router = express.Router();

const requireAuth = require("../../middleware/auth");
const validateObjectId = require("../../middleware/validateObjectId");

const {
    createJobV2,
    listJobsV2,
    getJobV2,
    updateJobV2,
    deleteJobV2,
} = require("../../controllers/admin/jobsV2.controllers");

const {
    createJobV2Schema,
    updateJobV2Schema,
    listJobV2QuerySchema,
    validate,
    validateQuery,
} = require("../../validators/jobV2");

router.post("/admin/jobs/v2", requireAuth, validate(createJobV2Schema), createJobV2);
router.get("/admin/jobs/v2", requireAuth, validateQuery(listJobV2QuerySchema), listJobsV2);
router.get("/admin/jobs/v2/:id", requireAuth, validateObjectId, getJobV2);
router.patch("/admin/jobs/v2/:id", requireAuth, validateObjectId, validate(updateJobV2Schema), updateJobV2);
router.delete("/admin/jobs/v2/:id", requireAuth, validateObjectId, deleteJobV2);

module.exports = router;
