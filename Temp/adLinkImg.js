const express = require("express");
const router = express.Router();

// import methods from controllers
const {getAds, deleteAds, addAds, updateClick} = require("../controllers/adLinkImg")

router.get("/sda/linkimg/get", getAds);
router.delete("/sda/linkimg/delete/:id", deleteAds);
router.post("/sda/linkimg/add", addAds);
router.patch("/sda/linkimg/count/:id", updateClick);

module.exports = router;