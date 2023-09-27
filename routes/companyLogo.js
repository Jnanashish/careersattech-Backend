const express = require("express");
const router = express.Router();

const {getCompanyLogo, addCompanyLogo, updateCompanyLogo} = require("../controllers/companyLogo")

router.get("/companylogo", getCompanyLogo);
router.post("/companylogo/add", addCompanyLogo);
router.patch("/companylogo/:id", updateCompanyLogo);

module.exports = router;