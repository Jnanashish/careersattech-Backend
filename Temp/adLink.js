const express = require("express");
const router = express.Router();

// import methods from controllers
const {getAds, deleteAds, addAds, updateClick} = require("../controllers/adLink")

router.get("/sda/link/get", getAds);
router.delete("/sda/link/delete/:id", deleteAds);
router.post("/sda/link/add", addAds);
router.patch("/sda/link/count/:id", updateClick);

module.exports = router;