// One-time backfill: normalize every existing Jobdesc.jdpage into a boolean.
//
// Background: jdpage used to be declared `String` but the admin UI has long
// treated it as a show/hide toggle. The scraper's AI transformer also wrote
// `null` when it couldn't find a dedicated JD URL, which left scraped jobs
// with jdpage:null in prod and broke the public site's JD-page redirect.
//
// This script coerces every jdpage value to a boolean:
//   true / "true" / "1" / "yes" / any other non-empty string (incl. URLs) -> true
//   false / "false" / "0" / "no" / "" / null / missing                    -> true for
//                                                                            missing/null,
//                                                                            false for explicit off
//
// Per the linked ticket, we want jdpage:true for any row currently null/false,
// but we also want to clean up legacy URL strings so the new Boolean schema
// doesn't hit cast errors on read. We keep an explicit boolean `false` only if
// the stored value is unambiguously "off".
//
// Run once:
//   node scripts/backfill-jdpage.js
//
// Dry-run:
//   DRY_RUN=1 node scripts/backfill-jdpage.js

require("dotenv").config();
const mongoose = require("mongoose");

const DRY_RUN = process.env.DRY_RUN === "1";

async function main() {
    const DB = process.env.DATABASE;
    if (!DB) throw new Error("DATABASE env var required");
    await mongoose.connect(DB);

    const coll = mongoose.connection.db.collection("jobdescs");

    const total = await coll.countDocuments({});
    const nullish = await coll.countDocuments({
        $or: [{ jdpage: null }, { jdpage: { $exists: false } }],
    });
    const falsy = await coll.countDocuments({
        jdpage: { $in: [false, "false", "0", "no", ""] },
    });
    const already = await coll.countDocuments({ jdpage: true });

    console.log(`[backfill-jdpage] total=${total} true=${already} null/missing=${nullish} explicit-false=${falsy}`);

    if (DRY_RUN) {
        console.log("[backfill-jdpage] DRY_RUN=1 — no writes performed");
        await mongoose.disconnect();
        return;
    }

    // 1. Explicit "off" markers become boolean false.
    const offRes = await coll.updateMany(
        { jdpage: { $in: ["false", "0", "no", ""] } },
        { $set: { jdpage: false } }
    );

    // 2. Everything else — null, missing, legacy URL strings, "true", 1, etc. —
    //    becomes boolean true. We filter out values that are already boolean so
    //    we don't rewrite clean rows.
    const onRes = await coll.updateMany(
        { jdpage: { $not: { $type: "bool" } } },
        { $set: { jdpage: true } }
    );

    console.log(
        `[backfill-jdpage] set false on ${offRes.modifiedCount} docs, set true on ${onRes.modifiedCount} docs`
    );

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
