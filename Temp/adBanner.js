const express = require("express");
const router = express.Router();

// import methods from controllers
const {getAds, deleteAds, addAds, updateClick} = require("../controllers/adBanner")

router.get("/sda/banner/get", getAds);
router.delete("/sda/banner/delete/:id", deleteAds);
router.post("/sda/banner/add", addAds);
router.patch("/sda/banner/count/:id", updateClick);

module.exports = router;