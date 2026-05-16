const config = require("./src/config");
const logger = require("./src/utils/logger");
const db = require("./src/config/db");
const app = require("./src/app");
const scraperScheduler = require("./src/jobs/scraper.scheduler");
const blogScheduler = require("./src/jobs/blog.scheduler");
const verifyJobsScheduler = require("./src/jobs/verifyJobs.scheduler");

db.connect();

app.listen(config.server.port, () => {
    logger.info(`Server running on port ${config.server.port}`);
    scraperScheduler.init();
    blogScheduler.init();
    verifyJobsScheduler.init();
});
