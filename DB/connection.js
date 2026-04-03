const mongoose = require("mongoose");

const DB = process.env.DATABASE;

if (!DB) {
    console.error("FATAL: DATABASE environment variable is not set");
    process.exit(1);
}

const connectWithRetry = (retries = 5, delay = 3000) => {
    mongoose
        .connect(DB)
        .then(() => {
            console.log("MongoDB connected successfully");
        })
        .catch((err) => {
            console.error(`MongoDB connection error (retries left: ${retries}):`, err.message);
            if (retries > 0) {
                setTimeout(() => connectWithRetry(retries - 1, delay * 2), delay);
            } else {
                console.error("FATAL: Could not connect to MongoDB after multiple retries");
                process.exit(1);
            }
        });
};

connectWithRetry();

mongoose.connection.on("disconnected", () => {
    console.warn("MongoDB disconnected. Attempting reconnect...");
});

mongoose.connection.on("error", (err) => {
    console.error("MongoDB connection error:", err.message);
});
