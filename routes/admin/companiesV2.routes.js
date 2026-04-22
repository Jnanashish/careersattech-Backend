const express = require("express");
const router = express.Router();

const requireAuth = require("../../middleware/auth");
const validateObjectId = require("../../middleware/validateObjectId");

const {
    createCompanyV2,
    listCompaniesV2,
    getCompanyV2,
    updateCompanyV2,
    deleteCompanyV2,
} = require("../../controllers/admin/companiesV2.controllers");

const {
    createCompanyV2Schema,
    updateCompanyV2Schema,
    listCompanyV2QuerySchema,
    validate,
    validateQuery,
} = require("../../validators/companyV2");

router.post("/admin/companies/v2", requireAuth, validate(createCompanyV2Schema), createCompanyV2);
router.get("/admin/companies/v2", requireAuth, validateQuery(listCompanyV2QuerySchema), listCompaniesV2);
router.get("/admin/companies/v2/:id", requireAuth, validateObjectId, getCompanyV2);
router.patch("/admin/companies/v2/:id", requireAuth, validateObjectId, validate(updateCompanyV2Schema), updateCompanyV2);
router.delete("/admin/companies/v2/:id", requireAuth, validateObjectId, deleteCompanyV2);

module.exports = router;
