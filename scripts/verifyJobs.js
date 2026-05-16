#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Manual job-verifier runner. Same code path as the cron, with flags for
 * targeting a subset and skipping side effects.
 *
 * Usage:
 *   node scripts/verifyJobs.js                     # full live run
 *   node scripts/verifyJobs.js --dry-run           # no DB writes, still emails
 *   node scripts/verifyJobs.js --dry-run --no-email
 *   node scripts/verifyJobs.js --limit=10
 *   node scripts/verifyJobs.js --jobId=<mongoId>
 *   node scripts/verifyJobs.js --slug=<job-slug>
 */

const mongoose = require("mongoose");

const config = require("../src/config");
const logger = require("../src/utils/logger");
const { runVerification } = require("../src/jobs/verifyJobs.scheduler");

function parseArgs(argv) {
    const out = { dryRun: false, limit: null, jobId: null, slug: null, skipEmail: false };
    for (const arg of argv.slice(2)) {
        if (arg === "--dry-run") out.dryRun = true;
        else if (arg === "--no-email") out.skipEmail = true;
        else if (arg.startsWith("--limit=")) out.limit = parseInt(arg.slice("--limit=".length), 10);
        else if (arg.startsWith("--jobId=")) out.jobId = arg.slice("--jobId=".length);
        else if (arg.startsWith("--slug=")) out.slug = arg.slice("--slug=".length);
        else if (arg === "--help" || arg === "-h") {
            console.log(
                [
                    "Usage:",
                    "  node scripts/verifyJobs.js [--dry-run] [--limit=N] [--jobId=ID | --slug=SLUG] [--no-email]",
                    "",
                    "Flags:",
                    "  --dry-run     Run verification, log results, but no DB writes.",
                    "  --limit=N     Only check the first N jobs (oldest verification first).",
                    "  --jobId=ID    Check a single job by Mongo ObjectId.",
                    "  --slug=SLUG   Check a single job by slug.",
                    "  --no-email    Skip the summary email.",
                ].join("\n")
            );
            process.exit(0);
        }
    }
    return out;
}

async function main() {
    const args = parseArgs(process.argv);

    logger.info(`[verify:cli] connecting to MongoDB`);
    await mongoose.connect(config.db.uri);

    try {
        const summary = await runVerification({
            trigger: "manual",
            dryRun: args.dryRun,
            limit: args.limit,
            jobId: args.jobId,
            slug: args.slug,
            skipEmail: args.skipEmail,
        });

        console.log("");
        console.log("──────── Run summary ────────");
        console.log(`  trigger:        ${summary.trigger}`);
        console.log(`  dryRun:         ${summary.dryRun}`);
        console.log(`  total checked:  ${summary.totalChecked}`);
        console.log(`  active:         ${summary.activeCount}`);
        console.log(`  archived:       ${summary.expiredCount}`);
        console.log(`  inconclusive:   ${summary.inconclusiveCount}`);
        console.log(`  duration:       ${summary.durationMs}ms`);
        console.log("");
    } finally {
        await mongoose.disconnect();
    }
}

if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error(`[verify:cli] FAILED: ${err.stack || err.message}`);
            mongoose.disconnect().finally(() => process.exit(1));
        });
}
