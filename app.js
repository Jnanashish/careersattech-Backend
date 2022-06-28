const express = require("express");
const app = express();
const dotenv = require("dotenv");
const fileUpload = require("express-fileupload");

// import the Routes 
const jdRoutes = require("./routes/jobDesc")
const adLinkImgRoutes = require("./routes/adLinkImg")
const adLink = require("./routes/adLink")
const adBanner = require("./routes/adBanner")
const showAdPop = require("./routes/showAdPop")

// connect to cofing file
require('dotenv').config();

// connect with database
require("./DB/conn");

app.use(fileUpload({
    useTempFiles:true
}))
app.use(express.json());

// link to the router files for all the routes
app.use("/api", jdRoutes);
app.use("/api", adLinkImgRoutes);
app.use("/api", adLink);
app.use("/api", adBanner);
app.use("/api", showAdPop);

// step for heroku
if(process.env.NODE_ENV == "production"){
    app.use(express.static("frontend/build"))
}

// conection to port
const PORT = process.env.PORT || 5000;
app.listen(PORT)