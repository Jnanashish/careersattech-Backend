const express = require("express");
const ctrl = require("../../controllers/public/companiesV2Public.controllers");

const router = express.Router();

router.get("/", ctrl.listCompanies);
router.get("/slugs", ctrl.listSlugs);
router.get("/:slug", ctrl.getCompanyBySlug);

router.use(ctrl.notFound);

module.exports = router;
