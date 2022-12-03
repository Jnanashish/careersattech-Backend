const mongoose = require("mongoose");

// get mongoose database url
const DB = process.env.DATABASE;

// Connect database to mongoose
mongoose
    .connect(DB, {})
    .then(() => {})
    .catch((err) => console.log("MONGOOSE CONNECTION ERROR-->", err));
