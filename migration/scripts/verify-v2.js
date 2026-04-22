const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });

const mongoose = require("mongoose");

require(path.join(__dirname, "..", "..", "DB", "connection"));

const JobV2 = require(path.join(__dirname, "..", "..", "model", "jobV2.schema"));
const CompanyV2 = require(path.join(__dirname, "..", "..", "model", "companyV2.schema"));

const COLORS = {
    reset: "\x1b[0m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    bold: "\x1b[1m",
};

function color(text, c) {
    return `${COLORS[c] || ""}${text}${COLORS.reset}`;
}

const warnings = [];
const errors = [];

function warn(msg) {
    warnings.push(msg);
    console.log(color(`  WARN: ${msg}`, "yellow"));
}

function fail(msg) {
    errors.push(msg);
    console.log(color(`  FAIL: ${msg}`, "red"));
}

function ok(msg) {
    console.log(color(`  OK:   ${msg}`, "green"));
}

function keyString(keyObj) {
    return Object.entries(keyObj)
        .map(([k, v]) => `${k}:${v}`)
        .join(",");
}

async function checkIndexes(Model, label) {
    console.log(color(`\n[${label}] Index check`, "bold"));
    const collName = Model.collection.collectionName;

    let dbIndexes;
    try {
        dbIndexes = await Model.collection.indexes();
    } catch (err) {
        fail(`${label}: unable to read indexes from DB (${err.message})`);
        return;
    }

    const schemaIndexes = Model.schema.indexes();

    // Path-level single-field indexes: schema.indexes() already includes these in
    // modern Mongoose (8.x). We still cross-check against schema paths to catch
    // `index: true` on SchemaTypes.
    const pathLevel = [];
    Model.schema.eachPath((p, t) => {
        if (t.options && t.options.index === true && p !== "_id") {
            pathLevel.push([{ [p]: 1 }, {}]);
        }
        if (t.options && t.options.unique === true && p !== "_id") {
            pathLevel.push([{ [p]: 1 }, { unique: true }]);
        }
    });

    // Merge + de-dupe by key-pattern string
    const schemaSet = new Map();
    for (const [key, opts] of [...schemaIndexes, ...pathLevel]) {
        const k = keyString(key);
        if (!schemaSet.has(k)) schemaSet.set(k, opts || {});
    }

    const dbSet = new Map();
    for (const idx of dbIndexes) {
        if (idx.name === "_id_") continue;
        dbSet.set(keyString(idx.key), idx);
    }

    console.log(`  DB collection: ${collName}`);
    console.log(`  DB indexes    (excl. _id_): ${dbSet.size}`);
    console.log(`  Schema indexes:             ${schemaSet.size}`);

    // DB indexes list
    for (const [k, idx] of dbSet.entries()) {
        const flags = [];
        if (idx.unique) flags.push("unique");
        if (idx.sparse) flags.push("sparse");
        if (idx.expireAfterSeconds !== undefined) flags.push(`ttl=${idx.expireAfterSeconds}s`);
        if (idx.collation) flags.push(`collation=${idx.collation.locale}/${idx.collation.strength}`);
        console.log(`    • db:     {${k}}${flags.length ? "  [" + flags.join(", ") + "]" : ""}  name=${idx.name}`);
    }

    // Missing: in schema but not in DB
    const missing = [];
    for (const [k, opts] of schemaSet.entries()) {
        if (!dbSet.has(k)) missing.push({ key: k, opts });
    }
    if (missing.length === 0) {
        ok(`${label}: no missing indexes`);
    } else {
        for (const m of missing) {
            warn(`${label}: MISSING index {${m.key}} (present in schema, not in DB — will be created on next model load)`);
        }
    }

    // Extra: in DB but not in schema
    const extra = [];
    for (const [k, idx] of dbSet.entries()) {
        if (!schemaSet.has(k)) extra.push({ key: k, idx });
    }
    if (extra.length === 0) {
        ok(`${label}: no extra indexes`);
    } else {
        for (const e of extra) {
            warn(`${label}: EXTRA index {${e.key}} (in DB, not in schema) name=${e.idx.name}`);
        }
    }
}

async function checkCounts() {
    console.log(color("\n[counts] Document counts", "bold"));
    const jobsV2 = await JobV2.countDocuments();
    const companiesV2 = await CompanyV2.countDocuments();

    const db = mongoose.connection.db;
    let legacyJobs = null;
    let legacyCompanies = null;
    try {
        legacyJobs = await db.collection("jobdescs").countDocuments();
    } catch (_) {
        legacyJobs = 0;
    }
    try {
        legacyCompanies = await db.collection("companylogos").countDocuments();
    } catch (_) {
        legacyCompanies = 0;
    }

    console.log(`  companies_v2:  ${companiesV2}`);
    console.log(`  jobs_v2:       ${jobsV2}`);
    console.log(`  jobdescs (legacy, read-only):      ${legacyJobs}`);
    console.log(`  companylogos (legacy, read-only):  ${legacyCompanies}`);

    return { jobsV2, companiesV2, legacyJobs, legacyCompanies };
}

async function checkOrphans() {
    console.log(color("\n[orphans] Job → Company reference check", "bold"));
    const jobs = await JobV2.find({}, { _id: 1, slug: 1, company: 1, companyName: 1 }).lean();
    const companyIds = new Set(
        (await CompanyV2.find({}, { _id: 1 }).lean()).map((c) => String(c._id))
    );

    const orphans = [];
    for (const j of jobs) {
        if (!j.company || !companyIds.has(String(j.company))) {
            orphans.push(j);
        }
    }
    if (orphans.length === 0) {
        ok(`All ${jobs.length} job(s) reference a valid company`);
    } else {
        for (const o of orphans) {
            warn(`Orphan job: _id=${o._id} slug=${o.slug} company=${o.company}`);
        }
    }
    return orphans.length;
}

function printSummary(counts, orphanCount) {
    console.log(color("\n=========== SUMMARY ===========", "bold"));
    console.log(`companies_v2:  ${counts.companiesV2}`);
    console.log(`jobs_v2:       ${counts.jobsV2}`);
    console.log(`jobdescs:      ${counts.legacyJobs}`);
    console.log(`companylogos:  ${counts.legacyCompanies}`);
    console.log(`orphans:       ${orphanCount}`);
    console.log(`warnings:      ${warnings.length}`);
    console.log(`errors:        ${errors.length}`);

    if (errors.length > 0) {
        console.log(color("\nRESULT: RED (errors)", "red"));
        return 1;
    }
    if (warnings.length > 0) {
        console.log(color("\nRESULT: YELLOW (warnings)", "yellow"));
        return 0;
    }
    console.log(color("\nRESULT: GREEN (all checks passed)", "green"));
    return 0;
}

async function main() {
    console.log(color("=== verify-v2 ===", "bold"));
    if (!mongoose.connection.readyState || mongoose.connection.readyState !== 1) {
        await mongoose.connection.asPromise();
    }

    await checkIndexes(CompanyV2, "companies_v2");
    await checkIndexes(JobV2, "jobs_v2");

    const counts = await checkCounts();
    const orphanCount = await checkOrphans();

    const exitCode = printSummary(counts, orphanCount);

    await mongoose.disconnect();
    process.exit(exitCode);
}

main().catch(async (err) => {
    console.error(color(`FATAL: ${err.message}`, "red"));
    console.error(err.stack);
    try {
        await mongoose.disconnect();
    } catch (_) {}
    process.exit(1);
});
