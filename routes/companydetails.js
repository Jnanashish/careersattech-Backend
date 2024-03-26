const express = require("express");
const router = express.Router();

const { addCompanyDetails, getCompanyDetails, getCompanyLogo, updateCompanyDetails } = require("../controllers/companyDetails");

router.post("/companydetails/add", addCompanyDetails); // add company details

router.get("/companydetails/get", getCompanyDetails), // get company details by id or company name

router.get("/companydetails/logo", getCompanyLogo); // Get company logo only by company name

router.put("/companydetails/update/:id", updateCompanyDetails); // Update company details by id

module.exports = router;