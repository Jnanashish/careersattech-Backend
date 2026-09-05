const config = require("./src/config");
const logger = require("./src/utils/logger");
const db = require("./src/config/db");
const app = require("./src/app");
const { notifyGeneralError } = require("./src/utils/telegram");
const scraperScheduler = require("./src/jobs/scraper.scheduler");
const blogScheduler = require("./src/jobs/blog.scheduler");
const verifyJobsScheduler = require("./src/jobs/verifyJobs.scheduler");

// Crash-level events. Node's default for both is to terminate, and that stays
// the behaviour here — the process is in an unknown state and Railway restarts
// it. The only change is getting the alert out first, with a hard timeout so a
// slow Telegram call can't wedge a dying process.
const ALERT_FLUSH_MS = 3000;

function fatal(kind, err) {
    logger.error(`${kind}: ${err && err.stack ? err.stack : err}`);
    Promise.race([
        notifyGeneralError(kind, err, { fatal: true }),
        new Promise((resolve) => setTimeout(resolve, ALERT_FLUSH_MS)),
    ]).finally(() => process.exit(1));
}

process.on("uncaughtException", (err) => fatal("uncaughtException", err));
process.on("unhandledRejection", (reason) => fatal("unhandledRejection", reason));

db.connect();

app.listen(config.server.port, () => {
    logger.info(`Server running on port ${config.server.port}`);
    scraperScheduler.init();
    blogScheduler.init();
    verifyJobsScheduler.init();
});
