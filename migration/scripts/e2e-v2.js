#!/usr/bin/env node

/**
 * End-to-end integration test for the V2 admin + public API surface.
 *
 * Assumes:
 *   - The dev server is already running at http://localhost:<PORT>
 *     (PORT read from env, defaults to project default of 5002).
 *   - `npm run db:v2:seed:reset` has been run so exactly 3 seeded companies
 *     and 10 seeded jobs exist.
 *
 * Creates/deletes its own test records; does not mutate seeded data
 * (except stats counters bumped via public click endpoints).
 *
 * Exits 0 on all pass, 1 on any failure.
 */

const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });

const PORT = process.env.PORT || 5002;
const BASE = `http://localhost:${PORT}`;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

if (!ADMIN_API_KEY) {
    console.error("FATAL: ADMIN_API_KEY must be set in .env so admin requests can authenticate.");
    process.exit(1);
}

const AUTH_HEADERS = {
    "Content-Type": "application/json",
    "x-api-key": ADMIN_API_KEY,
};

const results = [];

function record(id, description, expected, actual, pass, extra) {
    results.push({ id, description, expected, actual, pass, extra });
    const tag = pass ? "PASS" : "FAIL";
    const tail = extra ? ` — ${extra}` : "";
    console.log(`[${tag}] ${id}: ${description} (expected=${expected}, actual=${actual})${tail}`);
}

async function req(method, url, body, extraHeaders) {
    const headers = { ...AUTH_HEADERS, ...(extraHeaders || {}) };
    const opts = { method, headers, redirect: "manual" };
    if (body !== undefined && body !== null) opts.body = JSON.stringify(body);
    const res = await fetch(`${BASE}${url}`, opts);
    let json = null;
    const text = await res.text();
    if (text) {
        try {
            json = JSON.parse(text);
        } catch (_) {
            json = { _raw: text };
        }
    }
    return { status: res.status, body: json, headers: res.headers };
}

function pad(str, len) {
    str = String(str == null ? "" : str);
    if (str.length >= len) return str.slice(0, len);
    return str + " ".repeat(len - str.length);
}

function printTable() {
    const rows = [
        ["TC ID", "Description", "Expected", "Actual", "Pass/Fail"],
        ...results.map((r) => [r.id, r.description, String(r.expected), String(r.actual), r.pass ? "PASS" : "FAIL"]),
    ];
    const widths = [0, 0, 0, 0, 0];
    for (const row of rows) {
        for (let i = 0; i < row.length; i++) {
            if (String(row[i]).length > widths[i]) widths[i] = String(row[i]).length;
        }
    }
    const ruler = "-".repeat(widths.reduce((a, b) => a + b, 0) + 4 * 3);
    console.log("\n" + ruler);
    console.log(rows[0].map((c, i) => pad(c, widths[i])).join(" | "));
    console.log(ruler);
    for (let i = 1; i < rows.length; i++) {
        console.log(rows[i].map((c, j) => pad(c, widths[j])).join(" | "));
    }
    console.log(ruler);
    const passed = results.filter((r) => r.pass).length;
    const failed = results.length - passed;
    console.log(`TOTAL: ${results.length}  PASSED: ${passed}  FAILED: ${failed}`);
}

async function main() {
    console.log(`=== e2e-v2 ===`);
    console.log(`Target: ${BASE}`);

    // Sanity ping — the /api prefix is required; we probe a known route.
    try {
        await fetch(`${BASE}/api/admin/companies/v2?limit=1`, { headers: AUTH_HEADERS });
    } catch (err) {
        console.error(`FATAL: Could not reach dev server at ${BASE}. Is it running?`);
        console.error(err.message);
        process.exit(1);
    }

    // Track created records so we can always try to clean up at the end.
    const created = { companies: [], jobs: [] };

    // ─────────────────────────────────────────────────────────────────────
    // Admin — Companies
    // ─────────────────────────────────────────────────────────────────────

    const TEST_COMPANY_NAME = `E2ETestCo ${Date.now()}`;
    let testCompanyId = null;
    let testCompanySlug = null;

    // TC-01
    {
        const r = await req("POST", "/api/admin/companies/v2", {
            companyName: TEST_COMPANY_NAME,
            companyType: "product",
            industry: "Testing",
            headquarters: "Test City",
            website: "https://example.com",
            status: "active",
        });
        const pass = r.status === 201 && r.body && r.body.data && typeof r.body.data.slug === "string" && r.body.data.slug.length > 0;
        record("TC-01", "POST /admin/companies/v2 valid → 201 + slug", 201, r.status, pass, pass ? `slug=${r.body.data.slug}` : JSON.stringify(r.body));
        if (pass) {
            testCompanyId = r.body.data._id;
            testCompanySlug = r.body.data.slug;
            created.companies.push(testCompanyId);
        }
    }

    // TC-02
    {
        const r = await req("POST", "/api/admin/companies/v2", {
            companyName: TEST_COMPANY_NAME,
            companyType: "product",
            industry: "Testing",
        });
        const pass = r.status === 409;
        record("TC-02", "POST same company again → 409", 409, r.status, pass, pass ? "" : JSON.stringify(r.body));
        if (!pass && r.status === 201 && r.body && r.body.data && r.body.data._id) {
            created.companies.push(r.body.data._id);
        }
    }

    // TC-03
    {
        const r = await req("POST", "/api/admin/companies/v2", {
            industry: "Testing",
        });
        const pass = r.status === 400;
        record("TC-03", "POST missing companyName → 400", 400, r.status, pass);
    }

    // TC-04
    {
        const r = await req("GET", "/api/admin/companies/v2?page=1&limit=50");
        const total = r.body && typeof r.body.total === "number" ? r.body.total : -1;
        const hasPagination =
            r.body &&
            Array.isArray(r.body.companies) &&
            typeof r.body.total === "number" &&
            typeof r.body.page === "number" &&
            typeof r.body.totalPages === "number";
        const pass = r.status === 200 && hasPagination && total >= 4;
        record("TC-04", "GET /admin/companies/v2 → 200 + total>=4", 200, r.status, pass, `total=${total}`);
    }

    // TC-05
    {
        if (!testCompanyId) {
            record("TC-05", "GET /admin/companies/v2/:id", 200, "skip", false, "TC-01 failed — no id");
        } else {
            const r = await req("GET", `/api/admin/companies/v2/${testCompanyId}`);
            const pass =
                r.status === 200 &&
                r.body &&
                r.body.data &&
                typeof r.body.data.openJobsCount === "number";
            record("TC-05", "GET /admin/companies/v2/:id → 200 + openJobsCount", 200, r.status, pass, pass ? `openJobsCount=${r.body.data.openJobsCount}` : "");
        }
    }

    // TC-06
    {
        if (!testCompanyId) {
            record("TC-06", "PATCH /admin/companies/v2/:id (industry)", 200, "skip", false, "TC-01 failed — no id");
        } else {
            const newIndustry = "EdTech-Updated";
            const r = await req("PATCH", `/api/admin/companies/v2/${testCompanyId}`, {
                industry: newIndustry,
            });
            const pass =
                r.status === 200 &&
                r.body &&
                r.body.data &&
                r.body.data.industry === newIndustry;
            record("TC-06", "PATCH industry → 200 + updated", 200, r.status, pass, pass ? `industry=${r.body.data.industry}` : "");
        }
    }

    // TC-07 (delete the TC-01 test company — will be re-checked in cleanup too)
    {
        if (!testCompanyId) {
            record("TC-07", "DELETE /admin/companies/v2/:id", 200, "skip", false, "TC-01 failed — no id");
        } else {
            const r = await req("DELETE", `/api/admin/companies/v2/${testCompanyId}`);
            const pass = r.status === 200;
            record("TC-07", "DELETE /admin/companies/v2/:id → 200", 200, r.status, pass);
            if (pass) {
                // no longer needs cleanup
                created.companies = created.companies.filter((id) => id !== testCompanyId);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Admin — Jobs
    //
    // For job tests we need a valid seeded company ObjectId. Fetch one via
    // the list endpoint (the TC-01 company was just deleted in TC-07).
    // ─────────────────────────────────────────────────────────────────────

    let seededCompanyId = null;
    let seededCompanyName = null;
    {
        const r = await req("GET", "/api/admin/companies/v2?status=active&limit=5");
        if (r.body && Array.isArray(r.body.companies) && r.body.companies.length > 0) {
            // Prefer a company that is NOT our freshly-archived test company.
            const first = r.body.companies.find((c) => String(c._id) !== String(testCompanyId)) || r.body.companies[0];
            seededCompanyId = first._id;
            seededCompanyName = first.companyName;
        }
    }

    if (!seededCompanyId) {
        console.error("FATAL: no seeded company found — run `npm run db:v2:seed:reset` first.");
        printTable();
        process.exit(1);
    }

    const baseJobBody = {
        title: "E2E Test Engineer",
        company: seededCompanyId,
        companyName: seededCompanyName,
        displayMode: "internal",
        applyLink: "https://example.com/apply/e2e",
        employmentType: ["FULL_TIME"],
        batch: [2025, 2026],
        jobDescription: { html: "<p>End-to-end test job description.</p>" },
        category: "engineering",
        workMode: "remote",
        status: "draft",
    };

    let testJobId1 = null;
    let testJobSlug1 = null;
    let testJobId2 = null;
    let testJobSlug2 = null;
    let testJobId3 = null;

    // TC-08
    {
        const r = await req("POST", "/api/admin/jobs/v2", baseJobBody);
        const pass = r.status === 201 && r.body && r.body.data && r.body.data._id;
        record("TC-08", "POST internal job (valid) → 201", 201, r.status, pass, pass ? `slug=${r.body.data.slug}` : JSON.stringify(r.body));
        if (pass) {
            testJobId1 = r.body.data._id;
            testJobSlug1 = r.body.data.slug;
            created.jobs.push(testJobId1);
        }
    }

    // TC-09
    {
        const r = await req("POST", "/api/admin/jobs/v2", baseJobBody);
        const slugDiffers =
            r.body && r.body.data && r.body.data.slug && r.body.data.slug !== testJobSlug1;
        const pass = r.status === 201 && slugDiffers;
        record("TC-09", "POST identical body → 201 + different slug", 201, r.status, pass, pass ? `slug=${r.body.data.slug}` : "");
        if (r.status === 201 && r.body && r.body.data && r.body.data._id) {
            testJobId2 = r.body.data._id;
            testJobSlug2 = r.body.data.slug;
            created.jobs.push(testJobId2);
        }
    }

    // TC-10 — external_redirect without jobDescription
    {
        const body = {
            ...baseJobBody,
            title: "E2E External Only",
            displayMode: "external_redirect",
            applyLink: "https://external.example.com/apply",
        };
        delete body.jobDescription;
        const r = await req("POST", "/api/admin/jobs/v2", body);
        const pass = r.status === 201;
        record("TC-10", "POST external_redirect no JD → 201", 201, r.status, pass, pass ? "" : JSON.stringify(r.body));
        if (pass) {
            testJobId3 = r.body.data._id;
            created.jobs.push(testJobId3);
        }
    }

    // TC-11 — internal without jobDescription
    {
        const body = { ...baseJobBody, title: "E2E Invalid Internal" };
        delete body.jobDescription;
        const r = await req("POST", "/api/admin/jobs/v2", body);
        const pass = r.status === 400;
        record("TC-11", "POST internal no JD → 400 (pre-validate hook)", 400, r.status, pass, pass ? "" : JSON.stringify(r.body));
        if (r.status === 201 && r.body && r.body.data && r.body.data._id) {
            created.jobs.push(r.body.data._id);
        }
    }

    // TC-12 — invalid slug
    {
        const body = { ...baseJobBody, title: "E2E Bad Slug Job", slug: "Bad Slug!" };
        const r = await req("POST", "/api/admin/jobs/v2", body);
        const pass = r.status === 400;
        record("TC-12", 'POST invalid slug "Bad Slug!" → 400', 400, r.status, pass, pass ? "" : JSON.stringify(r.body));
        if (r.status === 201 && r.body && r.body.data && r.body.data._id) {
            created.jobs.push(r.body.data._id);
        }
    }

    // TC-13 — list jobs total >= 12
    {
        const r = await req("GET", "/api/admin/jobs/v2?page=1&limit=100");
        const total = r.body && typeof r.body.total === "number" ? r.body.total : -1;
        const pass = r.status === 200 && total >= 12;
        record("TC-13", "GET /admin/jobs/v2 → 200 + total>=12", 200, r.status, pass, `total=${total}`);
    }

    // TC-14 — single job populated
    {
        if (!testJobId1) {
            record("TC-14", "GET /admin/jobs/v2/:id populated", 200, "skip", false, "TC-08 failed");
        } else {
            const r = await req("GET", `/api/admin/jobs/v2/${testJobId1}`);
            const populated =
                r.body &&
                r.body.data &&
                r.body.data.company &&
                typeof r.body.data.company === "object" &&
                typeof r.body.data.company.companyName === "string";
            const pass = r.status === 200 && populated;
            record("TC-14", "GET /admin/jobs/v2/:id → 200 + company populated", 200, r.status, pass, populated ? `company.companyName=${r.body.data.company.companyName}` : "");
        }
    }

    // TC-15 — PATCH title only, slug unchanged
    {
        if (!testJobId1) {
            record("TC-15", "PATCH title only", 200, "skip", false, "TC-08 failed");
        } else {
            const newTitle = "E2E Test Engineer (Updated)";
            const r = await req("PATCH", `/api/admin/jobs/v2/${testJobId1}`, { title: newTitle });
            const pass =
                r.status === 200 &&
                r.body &&
                r.body.data &&
                r.body.data.title === newTitle &&
                r.body.data.slug === testJobSlug1;
            record("TC-15", "PATCH title → 200 + updated, slug unchanged", 200, r.status, pass, pass ? `slug=${r.body.data.slug}` : "");
        }
    }

    // TC-16 — PATCH slug to custom value
    const CUSTOM_SLUG = `custom-slug-xyz-${Date.now()}`;
    {
        if (!testJobId1) {
            record("TC-16", "PATCH slug to custom value", 200, "skip", false, "TC-08 failed");
        } else {
            const r = await req("PATCH", `/api/admin/jobs/v2/${testJobId1}`, { slug: CUSTOM_SLUG });
            const pass = r.status === 200 && r.body && r.body.data && r.body.data.slug === CUSTOM_SLUG;
            record("TC-16", "PATCH slug to custom → 200", 200, r.status, pass, pass ? `slug=${r.body.data.slug}` : "");
            if (pass) testJobSlug1 = CUSTOM_SLUG;
        }
    }

    // TC-17 — PATCH slug to existing slug (use job2's slug) → 409
    {
        if (!testJobId1 || !testJobSlug2) {
            record("TC-17", "PATCH slug to existing → 409", 409, "skip", false, "TC-08/09 failed");
        } else {
            const r = await req("PATCH", `/api/admin/jobs/v2/${testJobId1}`, { slug: testJobSlug2 });
            const pass = r.status === 409;
            record("TC-17", "PATCH slug to existing → 409", 409, r.status, pass, pass ? "" : JSON.stringify(r.body));
        }
    }

    // TC-18 — DELETE + confirm soft delete via 404 on subsequent GET
    {
        if (!testJobId1) {
            record("TC-18", "DELETE + confirm soft delete", 200, "skip", false, "TC-08 failed");
        } else {
            const del = await req("DELETE", `/api/admin/jobs/v2/${testJobId1}`);
            const get = await req("GET", `/api/admin/jobs/v2/${testJobId1}`);
            const pass = del.status === 200 && get.status === 404;
            record("TC-18", "DELETE → 200, then GET → 404", "200+404", `${del.status}+${get.status}`, pass);
            if (del.status === 200) {
                created.jobs = created.jobs.filter((id) => id !== testJobId1);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Admin — Referential integrity
    //
    // TC-19 — try to delete a seeded company that has published jobs → 409
    // We use the company we fetched earlier (seededCompanyId). It has at
    // least 2 published jobs from the seed script (e.g. Stripe has 3).
    // ─────────────────────────────────────────────────────────────────────

    // TC-19
    {
        const r = await req("DELETE", `/api/admin/companies/v2/${seededCompanyId}`);
        const pass = r.status === 409;
        record(
            "TC-19",
            "DELETE seeded company with published jobs → 409",
            409,
            r.status,
            pass,
            pass ? `company=${seededCompanyName}` : JSON.stringify(r.body)
        );
        if (r.status === 200) {
            // shouldn't happen, but if it did, the seeded company is now archived —
            // we can't restore it from this script; flag loudly.
            console.error(`!!! TC-19 archived a seeded company (${seededCompanyName}) — re-run \`npm run db:v2:seed:reset\` before the next e2e run.`);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Public — Click tracking
    //
    // Need a seeded, published job's slug. Fetch from the admin list with
    // status=published, then hit the public endpoints (no auth).
    // ─────────────────────────────────────────────────────────────────────

    let publishedSlug = null;
    let publishedApplyLink = null;
    {
        const r = await req("GET", "/api/admin/jobs/v2?status=published&limit=5");
        if (r.body && Array.isArray(r.body.jobs) && r.body.jobs.length > 0) {
            // Pick an internal one so applyLink is the internal URL from seed.
            const pick =
                r.body.jobs.find((j) => j.displayMode === "internal" && j.slug && j.applyLink) ||
                r.body.jobs[0];
            publishedSlug = pick.slug;
            publishedApplyLink = pick.applyLink;
        }
    }

    // TC-20
    {
        if (!publishedSlug) {
            record("TC-20", "GET /api/jobs/:slug/apply → 302", 302, "skip", false, "no seeded published job");
        } else {
            // No auth on public routes — override by omitting x-api-key.
            const res = await fetch(`${BASE}/api/jobs/${publishedSlug}/apply`, {
                method: "GET",
                redirect: "manual",
            });
            const loc = res.headers.get("location");
            const pass = res.status === 302 && loc === publishedApplyLink;
            record("TC-20", "GET /jobs/:slug/apply → 302 + location", 302, res.status, pass, `location=${loc}`);
        }
    }

    // TC-21
    {
        if (!publishedSlug) {
            record("TC-21", "POST /api/jobs/:slug/view → 200", 200, "skip", false, "no seeded published job");
        } else {
            const res = await fetch(`${BASE}/api/jobs/${publishedSlug}/view`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ referrer: "https://e2e.test" }),
            });
            const pass = res.status === 200;
            record("TC-21", "POST /jobs/:slug/view → 200", 200, res.status, pass);
        }
    }

    // TC-22
    {
        const res = await fetch(`${BASE}/api/jobs/non-existent-slug/apply`, {
            method: "GET",
            redirect: "manual",
        });
        const pass = res.status === 404;
        record("TC-22", "GET /jobs/non-existent-slug/apply → 404", 404, res.status, pass);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Cleanup
    //
    // Soft-delete anything we created that wasn't already archived.
    // ─────────────────────────────────────────────────────────────────────

    console.log("\n=== cleanup ===");
    for (const jobId of created.jobs) {
        try {
            const r = await req("DELETE", `/api/admin/jobs/v2/${jobId}`);
            console.log(`  [cleanup] DELETE job ${jobId} → ${r.status}`);
        } catch (err) {
            console.log(`  [cleanup] DELETE job ${jobId} → ERROR ${err.message}`);
        }
    }
    for (const companyId of created.companies) {
        try {
            const r = await req("DELETE", `/api/admin/companies/v2/${companyId}`);
            console.log(`  [cleanup] DELETE company ${companyId} → ${r.status}`);
        } catch (err) {
            console.log(`  [cleanup] DELETE company ${companyId} → ERROR ${err.message}`);
        }
    }

    printTable();

    const failed = results.filter((r) => !r.pass).length;
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error("FATAL:", err);
    printTable();
    process.exit(1);
});
