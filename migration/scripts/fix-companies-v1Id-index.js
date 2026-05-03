/**
 * One-shot migration: fix the unique v1Id index on companies_v2.
 *
 * The original index was a plain `{ v1Id: 1 } unique` from the v1 → v2
 * migration. Mongo treats `null` and "missing" as a value for unique
 * indexes, so any second company without a legacy v1 id collides on
 * `v1Id: null` and the whole approve flow 500s on E11000.
 *
 * Fix:
 *   1. Unset v1Id on every doc where it's literally null (not a string).
 *   2. Drop the old plain-unique index.
 *   3. Recreate it as partial-unique, only enforcing uniqueness when
 *      v1Id is a non-null string.
 *
 * Idempotent: safe to re-run. If the index is already partial, the
 * dropIndex step throws "index not found" with the expected shape and
 * we exit cleanly; if there are no null v1Id docs, the updateMany is
 * a no-op.
 *
 * Usage:
 *   node migration/scripts/fix-companies-v1Id-index.js
 */

const mongoose = require("mongoose");
require("dotenv").config();

const INDEX_NAME = "v1Id_1";
const PARTIAL_FILTER = { v1Id: { $type: "string" } };

async function run() {
    if (!process.env.DATABASE) {
        console.error("FATAL: DATABASE env var not set");
        process.exit(1);
    }

    await mongoose.connect(process.env.DATABASE);
    const coll = mongoose.connection.collection("companies_v2");

    // Step 1: scrub null v1Id (must come before recreating the partial index,
    // otherwise the build fails on existing duplicates).
    const unset = await coll.updateMany({ v1Id: null }, { $unset: { v1Id: "" } });
    console.log(`[migration] unset v1Id on ${unset.modifiedCount} docs (matched ${unset.matchedCount})`);

    // Step 2: inspect existing index so we can decide whether to rebuild.
    const indexes = await coll.indexes();
    const existing = indexes.find((i) => i.name === INDEX_NAME);
    const alreadyPartial =
        existing &&
        existing.partialFilterExpression &&
        JSON.stringify(existing.partialFilterExpression) === JSON.stringify(PARTIAL_FILTER);

    if (alreadyPartial) {
        console.log(`[migration] ${INDEX_NAME} already partial-unique on v1Id:string — nothing to do`);
    } else {
        if (existing) {
            console.log(`[migration] dropping existing ${INDEX_NAME} index (${JSON.stringify(existing)})`);
            await coll.dropIndex(INDEX_NAME);
        } else {
            console.log(`[migration] no existing ${INDEX_NAME} index — skipping drop`);
        }

        await coll.createIndex(
            { v1Id: 1 },
            {
                unique: true,
                partialFilterExpression: PARTIAL_FILTER,
                name: INDEX_NAME,
            }
        );
        console.log(`[migration] created partial-unique ${INDEX_NAME} on v1Id (string only)`);
    }

    const after = await coll.indexes();
    const v1IdIdx = after.find((i) => i.name === INDEX_NAME);
    console.log(`[migration] final v1Id index: ${JSON.stringify(v1IdIdx)}`);

    await mongoose.disconnect();
}

run().catch((err) => {
    console.error(`[migration] FAILED: ${err.message}`);
    process.exit(1);
});
