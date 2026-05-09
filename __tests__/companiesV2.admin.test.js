const request = require("supertest");
const mongoose = require("mongoose");

require("./setup");
const createApp = require("./createApp");
const CompanyV2 = require("../model/companyV2.schema");
const JobV2 = require("../model/jobV2.schema");

let app;
const AUTH = { "x-api-key": "test-secret-key" };

beforeAll(() => {
    app = createApp({ only: ["companiesV2Admin"] });
});

describe("POST /api/admin/companies/v2", () => {
    it("rejects without auth (401)", async () => {
        const res = await request(app).post("/api/admin/companies/v2").send({
            companyName: "Anonymous Co",
        });
        expect(res.status).toBe(401);
    });

    it("rejects empty payload (400)", async () => {
        const res = await request(app).post("/api/admin/companies/v2").set(AUTH).send({});
        expect(res.status).toBe(400);
    });

    it("creates company with auto-generated slug", async () => {
        const res = await request(app).post("/api/admin/companies/v2").set(AUTH).send({
            companyName: "Acme Corp",
            companyType: "startup",
        });

        expect(res.status).toBe(201);
        expect(res.body.data.slug).toBe("acme-corp");
    });

    it("conflicts on duplicate slug (409)", async () => {
        await request(app).post("/api/admin/companies/v2").set(AUTH).send({
            companyName: "Same Slug Co",
        });

        const res = await request(app).post("/api/admin/companies/v2").set(AUTH).send({
            companyName: "Same Slug Co",
            slug: "same-slug-co",
        });

        expect(res.status).toBe(409);
    });

    it("rejects invalid foundedYear (400)", async () => {
        const res = await request(app).post("/api/admin/companies/v2").set(AUTH).send({
            companyName: "Future Co",
            foundedYear: 9999,
        });
        expect(res.status).toBe(400);
    });
});

describe("GET /api/admin/companies/v2", () => {
    it("rejects without auth (401)", async () => {
        const res = await request(app).get("/api/admin/companies/v2");
        expect(res.status).toBe(401);
    });

    it("paginates and filters by industry", async () => {
        await CompanyV2.create({ companyName: "Fin Co", slug: "fin-co", industry: "fintech" });
        await CompanyV2.create({ companyName: "Health Co", slug: "health-co", industry: "healthtech" });

        const all = await request(app).get("/api/admin/companies/v2").set(AUTH);
        expect(all.status).toBe(200);
        expect(all.body.total).toBe(2);

        const fintech = await request(app).get("/api/admin/companies/v2?industry=fintech").set(AUTH);
        expect(fintech.body.total).toBe(1);
        expect(fintech.body.companies[0].industry).toBe("fintech");
    });

    it("excludes soft-deleted companies", async () => {
        await CompanyV2.create({
            companyName: "Deleted Co",
            slug: "deleted-co",
            deletedAt: new Date(),
        });
        const res = await request(app).get("/api/admin/companies/v2").set(AUTH);
        expect(res.body.total).toBe(0);
    });
});

describe("GET /api/admin/companies/v2/:id", () => {
    it("returns 404 for missing id", async () => {
        const fake = new mongoose.Types.ObjectId();
        const res = await request(app).get(`/api/admin/companies/v2/${fake}`).set(AUTH);
        expect(res.status).toBe(404);
    });

    it("attaches openJobsCount", async () => {
        const company = await CompanyV2.create({ companyName: "OpenJobs Co", slug: "openjobs-co" });
        await JobV2.create({
            title: "Eng",
            slug: "openjobs-co-eng",
            company: company._id,
            companyName: company.companyName,
            displayMode: "external_redirect",
            applyLink: "https://x",
            employmentType: ["FULL_TIME"],
            batch: [2024],
            status: "published",
        });

        const res = await request(app).get(`/api/admin/companies/v2/${company._id}`).set(AUTH);
        expect(res.status).toBe(200);
        expect(res.body.data.openJobsCount).toBe(1);
    });
});

describe("PATCH /api/admin/companies/v2/:id", () => {
    it("updates description", async () => {
        const company = await CompanyV2.create({ companyName: "Patch Co", slug: "patch-co" });
        const res = await request(app)
            .patch(`/api/admin/companies/v2/${company._id}`)
            .set(AUTH)
            .send({ description: { short: "Updated" } });

        expect(res.status).toBe(200);
        expect(res.body.data.description.short).toBe("Updated");
    });
});

describe("DELETE /api/admin/companies/v2/:id", () => {
    it("blocks delete when company has active jobs (409)", async () => {
        const company = await CompanyV2.create({ companyName: "Has Jobs", slug: "has-jobs" });
        await JobV2.create({
            title: "Job",
            slug: "has-jobs-active",
            company: company._id,
            companyName: company.companyName,
            displayMode: "external_redirect",
            applyLink: "https://x",
            employmentType: ["FULL_TIME"],
            batch: [2024],
            status: "published",
        });

        const res = await request(app).delete(`/api/admin/companies/v2/${company._id}`).set(AUTH);
        expect(res.status).toBe(409);
    });

    it("soft-deletes when no active jobs", async () => {
        const company = await CompanyV2.create({ companyName: "Empty Co", slug: "empty-co" });
        const res = await request(app).delete(`/api/admin/companies/v2/${company._id}`).set(AUTH);
        expect(res.status).toBe(200);

        const after = await CompanyV2.findById(company._id);
        expect(after.deletedAt).toBeTruthy();
        expect(after.status).toBe("archived");
    });
});
