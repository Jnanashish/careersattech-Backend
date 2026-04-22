const express = require("express");
const router = express.Router();

const sessionCookie = require("../../middleware/sessionCookie");
const { applyRedirect, logView } = require("../../controllers/public/jobsV2.controllers");

router.get("/jobs/:slug/apply", sessionCookie, applyRedirect);
router.post("/jobs/:slug/view", sessionCookie, logView);

module.exports = router;
