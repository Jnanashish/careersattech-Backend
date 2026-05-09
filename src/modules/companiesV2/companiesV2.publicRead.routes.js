const express = require("express");
const ctrl = require("./companiesV2.publicRead.controller");

const router = express.Router();

router.get("/", ctrl.listCompanies);
router.get("/slugs", ctrl.listSlugs);
router.get("/:slug", ctrl.getCompanyBySlug);

router.use(ctrl.notFound);

module.exports = router;
