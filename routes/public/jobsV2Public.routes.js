const express = require("express");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

const ctrl = require("../../controllers/public/jobsV2Public.controllers");

const router = express.Router();

// Per-IP+slug rate limit for tracking endpoints. Spec §3.8/§3.9: 10/min,
// silent drop on limit hit (still 204). ipKeyGenerator handles IPv6 safely.
const trackLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator: (req, res) => `${ipKeyGenerator(req, res)}:${req.params.slug || ""}`,
    handler: (req, res) => res.status(204).end(),
});

// More-specific paths must come before /:slug so they don't get captured.
router.get("/", ctrl.listJobs);
router.get("/slugs", ctrl.listSlugs);
router.get("/by-id/:id", ctrl.resolveLegacyId);
router.get("/:slug", ctrl.getJobBySlug);
router.post("/:slug/track-view", trackLimiter, ctrl.trackView);
router.post("/:slug/track-apply", trackLimiter, ctrl.trackApply);

// JSON 404 fallback (replaces Express's default HTML 404)
router.use(ctrl.notFound);

module.exports = router;
