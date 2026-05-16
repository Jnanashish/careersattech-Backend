/* eslint-disable no-console */
/**
 * Idempotent migration: backfill verification subdoc + archivedAt + archivedReason
 * on every existing jobs_v2 document.
 *
 * Safe to re-run — only writes to docs that are missing one or more fields.
 *
 * Usage:
 *   node scripts/migrations/addVerificationFields.js
 */

const mongoose = require("mongoose");
const config = require("../../src/config");
const JobV2 = require("../../src/modules/jobsV2/jobsV2.model");

const DEFAULT_VERIFICATION = {
    lastCheckedAt: null,
    lastCheckResult: null,
    lastCheckReason: null,
    lastCheckStatusCode: null,
    lastCheckFinalUrl: null,
    consecutiveInconclusive: 0,
};

async function run() {
    await mongoose.connect(config.db.uri);
    console.log(`[migration] connected to MongoDB`);

    const totalBefore = await JobV2.countDocuments({});
    const missingVerification = await JobV2.countDocuments({
        verification: { $exists: false },
    });
    const missingArchivedAt = await JobV2.countDocuments({
        archivedAt: { $exists: false },
    });
    const missingArchivedReason = await JobV2.countDocuments({
        archivedReason: { $exists: false },
    });

    console.log(`[migration] before:`);
    console.log(`  total jobs_v2 docs:          ${totalBefore}`);
    console.log(`  missing verification:        ${missingVerification}`);
    console.log(`  missing archivedAt:          ${missingArchivedAt}`);
    console.log(`  missing archivedReason:      ${missingArchivedReason}`);

    let written = 0;

    if (missingVerification > 0) {
        const r = await JobV2.updateMany(
            { verification: { $exists: false } },
            { $set: { verification: DEFAULT_VERIFICATION } }
        );
        written += r.modifiedCount || 0;
        console.log(`[migration] set default verification on ${r.modifiedCount} docs`);
    }

    if (missingArchivedAt > 0) {
        const r = await JobV2.updateMany(
            { archivedAt: { $exists: false } },
            { $set: { archivedAt: null } }
        );
        written += r.modifiedCount || 0;
        console.log(`[migration] set default archivedAt on ${r.modifiedCount} docs`);
    }

    if (missingArchivedReason > 0) {
        const r = await JobV2.updateMany(
            { archivedReason: { $exists: false } },
            { $set: { archivedReason: null } }
        );
        written += r.modifiedCount || 0;
        console.log(`[migration] set default archivedReason on ${r.modifiedCount} docs`);
    }

    const totalAfter = await JobV2.countDocuments({});
    const stillMissingVerification = await JobV2.countDocuments({
        verification: { $exists: false },
    });

    console.log(`[migration] after:`);
    console.log(`  total jobs_v2 docs:          ${totalAfter}`);
    console.log(`  still missing verification:  ${stillMissingVerification}`);
    console.log(`  total docs written:          ${written}`);

    await mongoose.disconnect();
    console.log(`[migration] done`);
}

if (require.main === module) {
    run().catch((err) => {
        console.error(`[migration] FAILED: ${err.stack || err.message}`);
        mongoose.disconnect().finally(() => process.exit(1));
    });
}

module.exports = { run };
