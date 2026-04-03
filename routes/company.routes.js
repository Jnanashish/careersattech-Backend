const express = require("express");
const router = express.Router();
const cors = require("cors");

const requireAuth = require("../middleware/auth");
const validateObjectId = require("../middleware/validateObjectId");

const { addCompanyDetails, getCompanyDetails, getCompanyLogo, updateCompanyDetails, deleteCompanyDetails } = require("../controllers/company.controllers");

const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",")
    : ["http://localhost:3000"];

router.use(
    cors({
        origin: allowedOrigins,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    })
);
router.options("*", cors({ origin: allowedOrigins }));

router.post("/companydetails/add", requireAuth, addCompanyDetails);

router.get("/companydetails/get", getCompanyDetails);

router.get("/companydetails/logo", getCompanyLogo);

router.put("/companydetails/update/:id", requireAuth, validateObjectId, updateCompanyDetails);

router.delete("/companydetails/delete/:id", requireAuth, validateObjectId, deleteCompanyDetails);

module.exports = router;
