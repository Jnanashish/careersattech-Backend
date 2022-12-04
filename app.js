const express = require("express");
const app = express();
const dotenv = require("dotenv");
const fileUpload = require("express-fileupload");

// import the routes
const jdRoutes = require("./routes/jobDesc");
const adLinkImgRoutes = require("./routes/adLinkImg");
const adLink = require("./routes/adLink");
const adBanner = require("./routes/adBanner");
const showAdPop = require("./routes/showAdPop");

// connect to cofing file
require("dotenv").config();

// connect with database mongoose (url)
require("./DB/connection");

app.use(
    fileUpload({
        useTempFiles: true,
    })
);
app.use(express.json());

// link to the router files for all the available routes routes appended with api
app.use("/api", jdRoutes);
app.use("/api", adLinkImgRoutes);
app.use("/api", adLink);
app.use("/api", adBanner);
app.use("/api", showAdPop);

// // step for heroku environment
// if (process.env.NODE_ENV == "production") {
//     app.use(express.static("frontend/build"));
// }

// conection to port by default 5000
const PORT = process.env.PORT || 5000;
app.listen(PORT);
