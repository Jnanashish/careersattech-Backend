const express = require("express");
const router = express.Router();

const requireAuth = require("../../middleware/auth");
const validateObjectId = require("../../middleware/validateObjectId");
const requirePermanentFlag = require("../../middleware/requirePermanentFlag");

const {
    createCompanyV2,
    listCompaniesV2,
    getCompanyV2,
    updateCompanyV2,
    archiveCompanyV2,
    restoreCompanyV2,
    hardDeleteCompanyV2,
} = require("./companiesV2.controller");

const {
    createCompanyV2Schema,
    updateCompanyV2Schema,
    listCompanyV2QuerySchema,
    validate,
    validateQuery,
} = require("./companiesV2.validators");

router.post("/admin/companies/v2", requireAuth, validate(createCompanyV2Schema), createCompanyV2);
router.get("/admin/companies/v2", requireAuth, validateQuery(listCompanyV2QuerySchema), listCompaniesV2);
router.get("/admin/companies/v2/:id", requireAuth, validateObjectId, getCompanyV2);
router.patch("/admin/companies/v2/:id", requireAuth, validateObjectId, validate(updateCompanyV2Schema), updateCompanyV2);
// POST /:id/archive = reversible soft delete, undone by /:id/restore.
// DELETE /:id = permanent removal, gated behind an explicit ?permanent=true.
router.post("/admin/companies/v2/:id/archive", requireAuth, validateObjectId, archiveCompanyV2);
router.post("/admin/companies/v2/:id/restore", requireAuth, validateObjectId, restoreCompanyV2);
router.delete(
    "/admin/companies/v2/:id",
    requireAuth,
    validateObjectId,
    requirePermanentFlag,
    hardDeleteCompanyV2
);

module.exports = router;
