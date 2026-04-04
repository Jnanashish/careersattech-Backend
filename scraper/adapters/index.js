const fs = require("fs");
const path = require("path");

const skipFiles = ["_template.js", "index.js"];

const adapters = fs
    .readdirSync(__dirname)
    .filter((file) => file.endsWith(".js") && !skipFiles.includes(file))
    .map((file) => require(path.join(__dirname, file)))
    .filter((adapter) => adapter.enabled);

module.exports = adapters;
