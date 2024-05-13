const express = require("express");
const app = express();
const dotenv = require("dotenv");
const fileUpload = require("express-fileupload");

// import the routes
const jobdetailsRoutes = require("./routes/jobs.routes");
const companydetailsRoutes = require("./routes/company.routes");

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
app.use("/api", jobdetailsRoutes);
app.use("/api", companydetailsRoutes);

// connection to port by default 5000
const PORT = process.env.PORT || 5002;
app.listen(PORT);