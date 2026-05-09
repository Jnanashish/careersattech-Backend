const request = require("supertest");
const mongoose = require("mongoose");

require("./setup");
const createApp = require("./createApp");
const JobV2 = require("../model/jobV2.schema");
const CompanyV2 = require("../model/companyV2.schema");

let app;
const AUTH = { "x-api-key": "test-secret-key" };

beforeAll(() => {
    app = createApp({ only: ["jobsV2Admin"] });
});

async function createCompany(overrides = {}) {
    return CompanyV2.create({
        companyName: overrides.companyName || "TestCo",
        slug: overrides.slug || "testco-" + Math.random().toString(36).slice(2, 8),
        ...overrides,
    });
}

function validJobPayload(company, overrides = {}) {
    return {
        title: "Senior Backend Engineer",
        company: company._id.toString(),
        companyName: company.companyName,
        displayMode: "internal",
        applyLink: "https://example.com/apply",
        employmentType: ["FULL_TIME"],
        batch: [2024, 2025],
        jobDescription: { html: "<p>Build great APIs.</p>" },
        ...overrides,
    };
}

describe("POST /api/admin/jobs/v2", () => {
    it("rejects without auth (401)", async () => {
        const res = await request(app).post("/api/admin/jobs/v2").send({});
        expect(res.status).toBe(401);
    });

    it("rejects invalid payload (400)", async () => {
        const res = await request(app).post("/api/admin/jobs/v2").set(AUTH).send({
            title: "Missing fields",
        });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Validation failed");
    });

    it("creates job with auto-generated slug", async () => {
        const company = await createCompany({ companyName: "Acme" });
        const res = await request(app)
            .post("/api/admin/jobs/v2")
            .set(AUTH)
            .send(validJobPayload(company));

        expect(res.status).toBe(201);
        expect(res.body.data.slug).toMatch(/^acme-senior-backend-engineer-/);

        const stored = await JobV2.findOne({ _id: res.body.data._id });
        expect(stored.companyName).toBe("Acme");
        expect(stored.status).toBe("draft");
    });

    it("rejects internal displayMode without job description html (400)", async () => {
        const company = await createCompany();
        const res = await request(app)
            .post("/api/admin/jobs/v2")
            .set(AUTH)
            .send(validJobPayload(company, { jobDescription: undefined }));

        expect(res.status).toBe(400);
    });

    it("conflicts on duplicate explicit slug (409)", async () => {
        const company = await createCompany();
        await request(app)
            .post("/api/admin/jobs/v2")
            .set(AUTH)
            .send(validJobPayload(company, { slug: "duplicate-slug" }));

        const res = await request(app)
            .post("/api/admin/jobs/v2")
            .set(AUTH)
            .send(validJobPayload(company, { slug: "duplicate-slug", title: "Other" }));

        expect(res.status).toBe(409);
    });
});

describe("GET /api/admin/jobs/v2", () => {
    it("rejects without auth (401)", async () => {
        const res = await request(app).get("/api/admin/jobs/v2");
        expect(res.status).toBe(401);
    });

    it("paginates and filters by status", async () => {
        const company = await createCompany();
        await request(app).post("/api/admin/jobs/v2").set(AUTH).send(validJobPayload(company, { title: "Draft Job" }));
        await JobV2.create({
            ...validJobPayload(company, { title: "Published Job" }),
            slug: "published-job-x",
            status: "published",
        });

        const all = await request(app).get("/api/admin/jobs/v2").set(AUTH);
        expect(all.status).toBe(200);
        expect(all.body.total).toBe(2);

        const onlyPublished = await request(app)
            .get("/api/admin/jobs/v2?status=published")
            .set(AUTH);
        expect(onlyPublished.body.total).toBe(1);
        expect(onlyPublished.body.jobs[0].status).toBe("published");
    });

    it("excludes soft-deleted jobs from list", async () => {
        const company = await createCompany();
        const job = await JobV2.create({
            ...validJobPayload(company),
            slug: "soft-deleted",
            deletedAt: new Date(),
        });
        const res = await request(app).get("/api/admin/jobs/v2").set(AUTH);
        expect(res.body.total).toBe(0);
        expect(res.body.jobs.find((j) => j._id === job._id.toString())).toBeUndefined();
    });
});

describe("GET /api/admin/jobs/v2/:id", () => {
    it("returns 400 on invalid id", async () => {
        const res = await request(app).get("/api/admin/jobs/v2/not-an-id").set(AUTH);
        expect(res.status).toBe(400);
    });

    it("returns 404 for non-existent job", async () => {
        const fake = new mongoose.Types.ObjectId();
        const res = await request(app).get(`/api/admin/jobs/v2/${fake}`).set(AUTH);
        expect(res.status).toBe(404);
    });

    it("returns single job with populated company", async () => {
        const company = await createCompany();
        const job = await JobV2.create({ ...validJobPayload(company), slug: "single-job" });

        const res = await request(app).get(`/api/admin/jobs/v2/${job._id}`).set(AUTH);
        expect(res.status).toBe(200);
        expect(res.body.data.company.companyName).toBe(company.companyName);
    });
});

describe("PATCH /api/admin/jobs/v2/:id", () => {
    it("updates allowed fields", async () => {
        const company = await createCompany();
        const job = await JobV2.create({ ...validJobPayload(company), slug: "update-job" });

        const res = await request(app)
            .patch(`/api/admin/jobs/v2/${job._id}`)
            .set(AUTH)
            .send({ title: "Updated Title" });

        expect(res.status).toBe(200);
        expect(res.body.data.title).toBe("Updated Title");
    });

    it("rejects invalid update payload (400)", async () => {
        const company = await createCompany();
        const job = await JobV2.create({ ...validJobPayload(company), slug: "update-job-2" });

        const res = await request(app)
            .patch(`/api/admin/jobs/v2/${job._id}`)
            .set(AUTH)
            .send({ employmentType: ["NOT_A_VALID_TYPE"] });

        expect(res.status).toBe(400);
    });
});

describe("DELETE /api/admin/jobs/v2/:id", () => {
    it("soft-deletes job (sets deletedAt + archived)", async () => {
        const company = await createCompany();
        const job = await JobV2.create({ ...validJobPayload(company), slug: "del-job" });

        const res = await request(app).delete(`/api/admin/jobs/v2/${job._id}`).set(AUTH);

        expect(res.status).toBe(200);

        const after = await JobV2.findById(job._id);
        expect(after.deletedAt).toBeTruthy();
        expect(after.status).toBe("archived");
    });

    it("returns 404 if already soft-deleted", async () => {
        const company = await createCompany();
        const job = await JobV2.create({
            ...validJobPayload(company),
            slug: "already-del",
            deletedAt: new Date(),
        });

        const res = await request(app).delete(`/api/admin/jobs/v2/${job._id}`).set(AUTH);
        expect(res.status).toBe(404);
    });
});
