const express = require("express");
const router = express.Router();

const requireAuth = require("../middleware/auth");
const validateObjectId = require("../middleware/validateObjectId");

const { addCompanyDetails, getCompanyDetails, getCompanyLogo, updateCompanyDetails, deleteCompanyDetails } = require("../controllers/company.controllers");

router.post("/companydetails/add", requireAuth, addCompanyDetails);

router.get("/companydetails/get", getCompanyDetails);

router.get("/companydetails/logo", getCompanyLogo);

router.put("/companydetails/update/:id", requireAuth, validateObjectId, updateCompanyDetails);

router.delete("/companydetails/delete/:id", requireAuth, validateObjectId, deleteCompanyDetails);

module.exports = router;
