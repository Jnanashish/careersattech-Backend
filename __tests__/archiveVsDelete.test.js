require("./setup");

// Covers the archive/delete split across every v2 + blog admin surface:
//   POST   .../:id/archive → reversible, document stays in Mongo
//   DELETE .../:id         → permanent, document leaves Mongo
// The two must never be confused, so each suite asserts the document's actual
// presence rather than just the response body.

const express = require("express");
const request = require("supertest");

// blog.controller's ISR webhook is a no-op unless NEXT_REVALIDATION_URL +
// REVALIDATE_SECRET are set, and setup.js sets neither — so these stay offline.

const JobV2 = require("../src/modules/jobsV2/jobsV2.model");
const JobClickV2 = require("../src/modules/jobsV2/jobClickV2.model");
const CompanyV2 = require("../src/modules/companiesV2/companiesV2.model");
const Blog = require("../src/modules/blog/blog.model");

let app;
beforeAll(() => {
    app = express();
    app.use(express.json({ limit: "1mb" }));
    app.use("/api", require("../src/modules/jobsV2/jobsV2.admin.routes"));
    app.use("/api", require("../src/modules/companiesV2/companiesV2.admin.routes"));
    app.use("/api", require("../src/modules/blog/blog.admin.routes"));
});

const auth = { "x-api-key": "test-secret-key" };

async function makeCompany(name = "AcmeCo", slug = "acmeco") {
    return CompanyV2.create({ companyName: name, slug });
}

async function makeJob(company, slug = "test-job", extra = {}) {
    return JobV2.create({
        title: "Test Job",
        slug,
        company: company._id,
        companyName: company.companyName,
        displayMode: "external_redirect",
        applyLink: `https://example.com/jobs/${slug}`,
        employmentType: ["FULL_TIME"],
        batch: [2024],
        status: "published",
        ...extra,
    });
}

// ─── Jobs v2 ────────────────────────────────────────────────────────

describe("jobs v2 archive vs delete", () => {
    test("POST /:id/archive soft-deletes and keeps the document", async () => {
        const company = await makeCompany();
        const job = await makeJob(company);

        const res = await request(app)
            .post(`/api/admin/jobs/v2/${job._id}/archive`)
            .set(auth);

        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Job archived");

        const fresh = await JobV2.findById(job._id).lean();
        expect(fresh).not.toBeNull();
        expect(fresh.status).toBe("archived");
        expect(fresh.deletedAt).toBeInstanceOf(Date);
    });

    test("POST /:id/archive returns 404 for an already-archived job", async () => {
        const company = await makeCompany();
        const job = await makeJob(company, "gone", { deletedAt: new Date(), status: "archived" });

        const res = await request(app)
            .post(`/api/admin/jobs/v2/${job._id}/archive`)
            .set(auth);

        expect(res.status).toBe(404);
    });

    test("DELETE /:id removes the document and its click events", async () => {
        const company = await makeCompany();
        const job = await makeJob(company);
        await JobClickV2.create({ job: job._id, eventType: "apply_click" });
        await JobClickV2.create({ job: job._id, eventType: "detail_view" });

        const res = await request(app).delete(`/api/admin/jobs/v2/${job._id}?permanent=true`).set(auth);

        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Job permanently deleted");
        expect(res.body.data.clickEventsDeleted).toBe(2);

        expect(await JobV2.findById(job._id).lean()).toBeNull();
        expect(await JobClickV2.countDocuments({ job: job._id })).toBe(0);
    });

    test("DELETE /:id works on an already-archived job (archive-then-delete flow)", async () => {
        const company = await makeCompany();
        const job = await makeJob(company, "stale", { deletedAt: new Date(), status: "archived" });

        const res = await request(app).delete(`/api/admin/jobs/v2/${job._id}?permanent=true`).set(auth);

        expect(res.status).toBe(200);
        expect(await JobV2.findById(job._id).lean()).toBeNull();
    });

    test("DELETE /:id frees the slug for reuse", async () => {
        const company = await makeCompany();
        const job = await makeJob(company, "reusable");

        await request(app).delete(`/api/admin/jobs/v2/${job._id}?permanent=true`).set(auth);

        // Would throw E11000 if the unique slug index still held the old doc.
        const recreated = await makeJob(company, "reusable");
        expect(recreated.slug).toBe("reusable");
    });

    test("DELETE without ?permanent=true is refused and changes nothing", async () => {
        const company = await makeCompany();
        const job = await makeJob(company);

        const res = await request(app).delete(`/api/admin/jobs/v2/${job._id}`).set(auth);

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/permanent=true/);
        expect(await JobV2.findById(job._id).lean()).not.toBeNull();
    });

    test("DELETE with a wrong permanent value is refused", async () => {
        const company = await makeCompany();
        const job = await makeJob(company);

        const res = await request(app)
            .delete(`/api/admin/jobs/v2/${job._id}?permanent=1`)
            .set(auth);

        expect(res.status).toBe(400);
        expect(await JobV2.findById(job._id).lean()).not.toBeNull();
    });

    test("POST /:id/restore clears deletedAt and returns the job to draft", async () => {
        const company = await makeCompany();
        const job = await makeJob(company, "back", {
            deletedAt: new Date(),
            status: "archived",
            archivedReason: "auto-verification-expired",
            archivedAt: new Date(),
        });

        const res = await request(app).post(`/api/admin/jobs/v2/${job._id}/restore`).set(auth);

        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Job restored");

        const fresh = await JobV2.findById(job._id).lean();
        expect(fresh.deletedAt).toBeNull();
        // Draft, not published — re-publishing is a deliberate second step.
        expect(fresh.status).toBe("draft");
        expect(fresh.archivedReason).toBeNull();
    });

    test("POST /:id/restore 404s on a job that is not archived", async () => {
        const company = await makeCompany();
        const job = await makeJob(company);

        const res = await request(app).post(`/api/admin/jobs/v2/${job._id}/restore`).set(auth);

        expect(res.status).toBe(404);
    });

    test("archive → restore round-trips", async () => {
        const company = await makeCompany();
        const job = await makeJob(company, "round-trip");

        await request(app).post(`/api/admin/jobs/v2/${job._id}/archive`).set(auth);
        await request(app).post(`/api/admin/jobs/v2/${job._id}/restore`).set(auth);

        const fresh = await JobV2.findById(job._id).lean();
        expect(fresh.deletedAt).toBeNull();
        expect(fresh.status).toBe("draft");
    });

    // Regression: a job reaches "archived" two ways — the cron sweeps set
    // status alone, POST /:id/archive also sets deletedAt. The admin UI shows
    // its Restore button on `status === "archived"`, so both shapes must be
    // listable AND restorable or the button is either dead or unreachable.
    test("restore works on a cron-archived job (status only, no deletedAt)", async () => {
        const company = await makeCompany();
        const job = await makeJob(company, "cron-archived", {
            status: "archived",
            archivedAt: new Date(),
            archivedReason: "auto-expired-validThrough",
        });

        const res = await request(app).post(`/api/admin/jobs/v2/${job._id}/restore`).set(auth);

        expect(res.status).toBe(200);
        const fresh = await JobV2.findById(job._id).lean();
        expect(fresh.status).toBe("draft");
        expect(fresh.archivedReason).toBeNull();
    });

    test("?status=archived lists jobs archived either way", async () => {
        const company = await makeCompany();
        // cron shape
        await makeJob(company, "cron-archived", {
            status: "archived",
            archivedAt: new Date(),
        });
        // UI shape — archived through the endpoint, so deletedAt is set
        const uiJob = await makeJob(company, "ui-archived");
        await request(app).post(`/api/admin/jobs/v2/${uiJob._id}/archive`).set(auth);

        const res = await request(app).get("/api/admin/jobs/v2?status=archived").set(auth);

        expect(res.status).toBe(200);
        const slugs = res.body.jobs.map((j) => j.slug);
        expect(slugs).toContain("cron-archived");
        expect(slugs).toContain("ui-archived");
    });

    test("?excludeArchived=true hides both archived shapes", async () => {
        const company = await makeCompany();
        await makeJob(company, "cron-archived", { status: "archived" });
        const uiJob = await makeJob(company, "ui-archived");
        await request(app).post(`/api/admin/jobs/v2/${uiJob._id}/archive`).set(auth);
        await makeJob(company, "live");

        const res = await request(app)
            .get("/api/admin/jobs/v2?excludeArchived=true")
            .set(auth);

        expect(res.body.jobs.map((j) => j.slug)).toEqual(["live"]);
    });

    test("default listing still hides soft-deleted jobs", async () => {
        const company = await makeCompany();
        const uiJob = await makeJob(company, "ui-archived");
        await request(app).post(`/api/admin/jobs/v2/${uiJob._id}/archive`).set(auth);
        await makeJob(company, "live");

        const res = await request(app).get("/api/admin/jobs/v2").set(auth);

        expect(res.body.jobs.map((j) => j.slug)).toEqual(["live"]);
    });

    // The admin list UI sends these three; they were silently stripped by Zod
    // before, so the filters rendered but did nothing.
    test("?employmentType filters on the array field", async () => {
        const company = await makeCompany();
        await makeJob(company, "ft", { employmentType: ["FULL_TIME"] });
        await makeJob(company, "intern", { employmentType: ["INTERN"] });
        await makeJob(company, "both", { employmentType: ["FULL_TIME", "INTERN"] });

        const res = await request(app)
            .get("/api/admin/jobs/v2?employmentType=INTERN")
            .set(auth);

        expect(res.status).toBe(200);
        expect(res.body.jobs.map((j) => j.slug).sort()).toEqual(["both", "intern"]);
    });

    test("?batch coerces the query string to a number and matches", async () => {
        const company = await makeCompany();
        await makeJob(company, "y2025", { batch: [2025] });
        await makeJob(company, "y2026", { batch: [2026] });
        await makeJob(company, "y-both", { batch: [2025, 2026] });

        const res = await request(app).get("/api/admin/jobs/v2?batch=2025").set(auth);

        expect(res.status).toBe(200);
        expect(res.body.jobs.map((j) => j.slug).sort()).toEqual(["y-both", "y2025"]);
    });

    test("?batch rejects a non-numeric value", async () => {
        const res = await request(app).get("/api/admin/jobs/v2?batch=abc").set(auth);
        expect(res.status).toBe(400);
    });

    test("?employmentType rejects a value outside the enum", async () => {
        const res = await request(app)
            .get("/api/admin/jobs/v2?employmentType=FREELANCE")
            .set(auth);
        expect(res.status).toBe(400);
    });

    test("?company filters by company id", async () => {
        const a = await makeCompany("Acme", "acme");
        const b = await makeCompany("Beta", "beta");
        await makeJob(a, "at-acme");
        await makeJob(b, "at-beta");

        const res = await request(app)
            .get(`/api/admin/jobs/v2?company=${a._id}`)
            .set(auth);

        expect(res.body.jobs.map((j) => j.slug)).toEqual(["at-acme"]);
    });

    test("filters combine with excludeArchived", async () => {
        const company = await makeCompany();
        await makeJob(company, "live-intern", { employmentType: ["INTERN"] });
        await makeJob(company, "archived-intern", {
            employmentType: ["INTERN"],
            status: "archived",
        });

        const res = await request(app)
            .get("/api/admin/jobs/v2?employmentType=INTERN&excludeArchived=true")
            .set(auth);

        expect(res.body.jobs.map((j) => j.slug)).toEqual(["live-intern"]);
    });

    test("all routes require auth", async () => {
        const company = await makeCompany();
        const job = await makeJob(company);

        expect((await request(app).post(`/api/admin/jobs/v2/${job._id}/archive`)).status).toBe(401);
        expect((await request(app).post(`/api/admin/jobs/v2/${job._id}/restore`)).status).toBe(401);
        expect((await request(app).delete(`/api/admin/jobs/v2/${job._id}?permanent=true`)).status).toBe(401);
    });

    test("both routes reject a malformed id", async () => {
        expect((await request(app).post("/api/admin/jobs/v2/not-an-id/archive").set(auth)).status).toBe(400);
        expect((await request(app).delete("/api/admin/jobs/v2/not-an-id?permanent=true").set(auth)).status).toBe(400);
    });
});

// ─── Companies v2 ───────────────────────────────────────────────────

describe("companies v2 archive vs delete", () => {
    test("POST /:id/archive soft-deletes and keeps the document", async () => {
        const company = await makeCompany();

        const res = await request(app)
            .post(`/api/admin/companies/v2/${company._id}/archive`)
            .set(auth);

        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Company archived");

        const fresh = await CompanyV2.findById(company._id).lean();
        expect(fresh).not.toBeNull();
        expect(fresh.status).toBe("archived");
        expect(fresh.deletedAt).toBeInstanceOf(Date);
    });

    test("POST /:id/archive is blocked by published jobs", async () => {
        const company = await makeCompany();
        await makeJob(company);

        const res = await request(app)
            .post(`/api/admin/companies/v2/${company._id}/archive`)
            .set(auth);

        expect(res.status).toBe(409);
        expect(await CompanyV2.findById(company._id).lean()).not.toBeNull();
    });

    test("DELETE /:id removes the document when nothing references it", async () => {
        const company = await makeCompany();

        const res = await request(app).delete(`/api/admin/companies/v2/${company._id}?permanent=true`).set(auth);

        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Company permanently deleted");
        expect(await CompanyV2.findById(company._id).lean()).toBeNull();
    });

    test("DELETE /:id is blocked by ANY referencing job, even a soft-deleted one", async () => {
        const company = await makeCompany();
        await makeJob(company, "archived-job", { deletedAt: new Date(), status: "archived" });

        const res = await request(app).delete(`/api/admin/companies/v2/${company._id}?permanent=true`).set(auth);

        expect(res.status).toBe(409);
        expect(res.body.error).toMatch(/still reference this company/);
        expect(await CompanyV2.findById(company._id).lean()).not.toBeNull();
    });

    test("DELETE without ?permanent=true is refused and changes nothing", async () => {
        const company = await makeCompany();

        const res = await request(app).delete(`/api/admin/companies/v2/${company._id}`).set(auth);

        expect(res.status).toBe(400);
        expect(await CompanyV2.findById(company._id).lean()).not.toBeNull();
    });

    test("POST /:id/restore clears deletedAt and returns the company to inactive", async () => {
        const company = await makeCompany();
        await request(app).post(`/api/admin/companies/v2/${company._id}/archive`).set(auth);

        const res = await request(app)
            .post(`/api/admin/companies/v2/${company._id}/restore`)
            .set(auth);

        expect(res.status).toBe(200);

        const fresh = await CompanyV2.findById(company._id).lean();
        expect(fresh.deletedAt).toBeNull();
        // CompanyV2's enum is active|inactive|archived — no draft.
        expect(fresh.status).toBe("inactive");
    });

    test("POST /:id/restore 404s on a company that is not archived", async () => {
        const company = await makeCompany();

        const res = await request(app)
            .post(`/api/admin/companies/v2/${company._id}/restore`)
            .set(auth);

        expect(res.status).toBe(404);
    });
});

// ─── Blog ───────────────────────────────────────────────────────────

describe("blog archive vs delete", () => {
    async function makeBlog(slug = "hello-world") {
        return Blog.create({
            title: "Hello World",
            slug,
            excerpt: "An excerpt",
            content: "# Hello",
            category: "career",
            author: { name: "Test Author" },
            status: "published",
            publishedAt: new Date(),
        });
    }

    test("POST /:id/archive flips status and keeps the document", async () => {
        const blog = await makeBlog();

        const res = await request(app).post(`/api/admin/blogs/${blog._id}/archive`).set(auth);

        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Blog archived");

        const fresh = await Blog.findById(blog._id).lean();
        expect(fresh).not.toBeNull();
        expect(fresh.status).toBe("archived");
    });

    test("DELETE /:id removes the document", async () => {
        const blog = await makeBlog();

        const res = await request(app).delete(`/api/admin/blogs/${blog._id}?permanent=true`).set(auth);

        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Blog permanently deleted");
        expect(await Blog.findById(blog._id).lean()).toBeNull();
    });

    test("DELETE /:id returns 404 for an unknown id", async () => {
        const res = await request(app)
            .delete("/api/admin/blogs/507f1f77bcf86cd799439011?permanent=true")
            .set(auth);
        expect(res.status).toBe(404);
    });

    test("DELETE without ?permanent=true is refused and changes nothing", async () => {
        const blog = await makeBlog();

        const res = await request(app).delete(`/api/admin/blogs/${blog._id}`).set(auth);

        expect(res.status).toBe(400);
        expect(await Blog.findById(blog._id).lean()).not.toBeNull();
    });
});
