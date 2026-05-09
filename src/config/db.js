const mongoose = require("mongoose");
const config = require("./index");
const logger = require("../utils/logger");

function connectWithRetry(retries = 5, delay = 3000) {
    return mongoose
        .connect(config.db.uri)
        .then(() => {
            logger.info("MongoDB connected successfully");
        })
        .catch((err) => {
            logger.error(`MongoDB connection error (retries left: ${retries}): ${err.message}`);
            if (retries > 0) {
                setTimeout(() => connectWithRetry(retries - 1, delay * 2), delay);
            } else {
                logger.error("FATAL: Could not connect to MongoDB after multiple retries");
                process.exit(1);
            }
        });
}

mongoose.connection.on("disconnected", () => {
    logger.warn("MongoDB disconnected. Attempting reconnect...");
});

mongoose.connection.on("error", (err) => {
    logger.error(`MongoDB connection error: ${err.message}`);
});

module.exports = { connect: connectWithRetry };
