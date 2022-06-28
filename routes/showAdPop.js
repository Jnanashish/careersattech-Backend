const express = require("express");
const router = express.Router();

// import methods from controllers
const {getAdPop, updateAdPop} = require("../controllers/showAdPop")

router.get("/showadpop/get", getAdPop);
router.put("/showadpop/update/:id", updateAdPop);

module.exports = router;