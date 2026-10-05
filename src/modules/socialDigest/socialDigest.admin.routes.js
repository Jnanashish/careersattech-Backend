const express = require("express");
const { z } = require("zod");
const router = express.Router();

const requireAuth = require("../../middleware/auth");
const { validateBody, validateQuery } = require("../../middleware/validate");
const { DIGEST_SIZE } = require("../../services/socialDigest");
const { previewSocialDigest, sendSocialDigest } = require("./socialDigest.controller");

// How many jobs to take, 1–DIGEST_SIZE: the digest's message-length budget is
// sized for at most six. Omitted → DIGEST_SIZE, the same as the cron.
const count = z.number().int().min(1).max(DIGEST_SIZE).optional();

// Strict, so a caller expecting some other option (a dry-run flag, a job list)
// is told no instead of silently sending the real digest.
const sendSocialDigestSchema = z.object({ count }).strict();

const previewSocialDigestQuerySchema = z.object({
    count: z.coerce.number().int().min(1).max(DIGEST_SIZE).optional(),
});

router.get(
    "/admin/social-digest/preview",
    requireAuth,
    validateQuery(previewSocialDigestQuerySchema),
    previewSocialDigest
);
router.post(
    "/admin/social-digest/send",
    requireAuth,
    validateBody(sendSocialDigestSchema),
    sendSocialDigest
);

module.exports = router;
