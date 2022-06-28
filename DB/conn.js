const mongoose = require("mongoose");
// require('dotenv').config();

const DB = process.env.DATABASE;

// Coneect to database
mongoose.connect(DB,{
}).then(()=>{
    console.log("Coneection sucessful");
}).catch((err) => console.log(err)) 