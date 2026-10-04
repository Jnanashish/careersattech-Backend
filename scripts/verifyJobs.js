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
 *   node scripts/verifyJobs.js --expiry-only --dry-run   # preview the date sweep
 *   node scripts/verifyJobs.js --expiry-sweep            # date sweep + link check
 *
 * The date sweep (--expiry-sweep / --expiry-only) is the same hard delete the
 * daily cron performs: jobs past their validThrough are removed from Mongo.
 * Pair it with --dry-run first to see exactly which documents would go.
 */

const mongoose = require("mongoose");

const config = require("../src/config");
const logger = require("../src/utils/logger");
const { runVerification, deleteExpiredJobs } = require("../src/jobs/verifyJobs.scheduler");

function parseArgs(argv) {
    const out = {
        dryRun: false,
        limit: null,
        jobId: null,
        slug: null,
        skipEmail: false,
        expirySweep: false,
        expiryOnly: false,
        graceDays: null,
    };
    for (const arg of argv.slice(2)) {
        if (arg === "--dry-run") out.dryRun = true;
        else if (arg === "--no-email") out.skipEmail = true;
        else if (arg === "--expiry-sweep") out.expirySweep = true;
        else if (arg === "--expiry-only") {
            out.expiryOnly = true;
            out.expirySweep = true;
        } else if (arg.startsWith("--grace-days=")) {
            out.graceDays = parseInt(arg.slice("--grace-days=".length), 10);
        } else if (arg.startsWith("--limit=")) out.limit = parseInt(arg.slice("--limit=".length), 10);
        else if (arg.startsWith("--jobId=")) out.jobId = arg.slice("--jobId=".length);
        else if (arg.startsWith("--slug=")) out.slug = arg.slice("--slug=".length);
        else if (arg === "--help" || arg === "-h") {
            console.log(
                [
                    "Usage:",
                    "  node scripts/verifyJobs.js [--dry-run] [--limit=N] [--jobId=ID | --slug=SLUG] [--no-email]",
                    "  node scripts/verifyJobs.js --expiry-only [--dry-run] [--grace-days=N]",
                    "",
                    "Flags:",
                    "  --dry-run       Run verification, log results, but no DB writes.",
                    "  --limit=N       Only check the first N jobs (oldest verification first).",
                    "  --jobId=ID      Check a single job by Mongo ObjectId.",
                    "  --slug=SLUG     Check a single job by slug.",
                    "  --no-email      Skip the summary email.",
                    "  --expiry-sweep  Also hard-delete jobs past their validThrough (what the",
                    "                  daily cron does) before checking apply links.",
                    "  --expiry-only   Run that date sweep and nothing else.",
                    "  --grace-days=N  Keep a date-expired job N days before deleting it",
                    "                  (default: EXPIRED_JOBS_GRACE_DAYS, or 0).",
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
        if (args.expirySweep) {
            const expiry = await deleteExpiredJobs({
                dryRun: args.dryRun,
                graceDays: Number.isFinite(args.graceDays) ? args.graceDays : undefined,
            });

            console.log("");
            console.log("──────── Expiry sweep ────────");
            console.log(`  dryRun:         ${expiry.dryRun}`);
            console.log(`  grace days:     ${expiry.graceDays}`);
            console.log(`  cutoff:         ${expiry.cutoff.toISOString()}`);
            console.log(`  matched:        ${expiry.matched}`);
            console.log(`  deleted:        ${expiry.deleted}`);
            console.log(`  click events:   ${expiry.clickEventsDeleted}`);
            for (const j of expiry.jobs) {
                console.log(`    • ${j.companyName} — ${j.title} (${j.slug}) ${j.reason}`);
            }
            console.log("");
        }

        if (args.expiryOnly) return;

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
