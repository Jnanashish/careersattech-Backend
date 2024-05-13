const express = require("express");
const router = express.Router();
const cors = require("cors");

const { addCompanyDetails, getCompanyDetails, getCompanyLogo, updateCompanyDetails, deleteCompanyDetails } = require("../controllers/company.controllers");

//allow cors
router.use(
    cors({
        origin: true,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    })
);
router.options("*", cors());

router.post("/companydetails/add", addCompanyDetails); // add company details

router.get("/companydetails/get", getCompanyDetails), // get company details by id or company name

router.get("/companydetails/logo", getCompanyLogo); // Get company logo only by company name

router.put("/companydetails/update/:id", updateCompanyDetails); // Update company details by id

router.delete("/companydetails/delete/:id", deleteCompanyDetails); // Update company details by id

module.exports = router;
