const express = require("express");
const { z } = require("zod");
const router = express.Router();

const requireAuth = require("../../middleware/auth");
const { validateBody } = require("../../middleware/validate");
const { previewSocialDigest, sendSocialDigest } = require("./socialDigest.controller");

// The send takes no parameters; strict so a caller expecting options (a dry-run
// flag, a job list) is told no instead of silently sending the real digest.
const sendSocialDigestSchema = z.object({}).strict();

router.get("/admin/social-digest/preview", requireAuth, previewSocialDigest);
router.post(
    "/admin/social-digest/send",
    requireAuth,
    validateBody(sendSocialDigestSchema),
    sendSocialDigest
);

module.exports = router;
