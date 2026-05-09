const request = require("supertest");
const mongoose = require("mongoose");

require("./setup");
const createApp = require("./createApp");
const StagingJob = require("../scraper/models/StagingJob");
const ScrapeLog = require("../scraper/models/ScrapeLog");
const CompanyV2 = require("../model/companyV2.schema");
const JobV2 = require("../model/jobV2.schema");

let app;
const ADMIN = { "x-admin-secret": "test-admin-secret" };

beforeAll(() => {
    app = createApp({ only: ["scraperAdmin"] });
});

async function makeStagingJob(overrides = {}) {
    return StagingJob.create({
        status: "pending",
        source: "test-adapter",
        sourceUrl: "https://example.com/job",
        companyPageUrl: "https://example.com/careers",
        fingerprint: overrides.fingerprint || "fp-" + Math.random().toString(36).slice(2, 10),
        jobData: {
            title: "Software Engineer",
            applyLink: "https://example.com/apply",
            displayMode: "external_redirect",
            employmentType: ["FULL_TIME"],
            batch: [2024, 2025],
            companyName: "ScrapedCo",
        },
        companyData: {
            companyName: "ScrapedCo",
            industry: "tech",
        },
        aiProvider: "gemini",
        ...overrides,
    });
}

describe("Scraper admin auth", () => {
    it("rejects without x-admin-secret (401)", async () => {
        const res = await request(app).get("/api/admin/scrape/staging");
        expect(res.status).toBe(401);
    });

    it("rejects with wrong secret (401)", async () => {
        const res = await request(app)
            .get("/api/admin/scrape/staging")
            .set("x-admin-secret", "wrong");
        expect(res.status).toBe(401);
    });

    it("accepts valid x-admin-secret", async () => {
        const res = await request(app).get("/api/admin/scrape/staging").set(ADMIN);
        expect(res.status).toBe(200);
    });
});

describe("GET /api/admin/scrape/staging", () => {
    it("paginates and filters by status", async () => {
        await makeStagingJob({ status: "pending" });
        await makeStagingJob({ status: "approved" });

        const all = await request(app).get("/api/admin/scrape/staging").set(ADMIN);
        expect(all.body.totalCount).toBe(2);

        const pending = await request(app)
            .get("/api/admin/scrape/staging?status=pending")
            .set(ADMIN);
        expect(pending.body.totalCount).toBe(1);
    });
});

describe("GET /api/admin/scrape/staging/:id", () => {
    it("returns 400 on invalid id", async () => {
        const res = await request(app).get("/api/admin/scrape/staging/not-an-id").set(ADMIN);
        expect(res.status).toBe(400);
    });

    it("returns 404 on missing", async () => {
        const fake = new mongoose.Types.ObjectId();
        const res = await request(app).get(`/api/admin/scrape/staging/${fake}`).set(ADMIN);
        expect(res.status).toBe(404);
    });

    it("returns staging row", async () => {
        const s = await makeStagingJob();
        const res = await request(app).get(`/api/admin/scrape/staging/${s._id}`).set(ADMIN);
        expect(res.status).toBe(200);
        expect(res.body.data.fingerprint).toBe(s.fingerprint);
    });
});

describe("POST /api/admin/scrape/staging/:id/reject", () => {
    it("marks staging job rejected with reason", async () => {
        const s = await makeStagingJob();
        const res = await request(app)
            .post(`/api/admin/scrape/staging/${s._id}/reject`)
            .set(ADMIN)
            .send({ reason: "spam" });

        expect(res.status).toBe(200);
        const fresh = await StagingJob.findById(s._id);
        expect(fresh.status).toBe("rejected");
        expect(fresh.rejectedReason).toBe("spam");
    });

    it("blocks rejecting an already-approved job", async () => {
        const s = await makeStagingJob({ status: "approved" });
        const res = await request(app)
            .post(`/api/admin/scrape/staging/${s._id}/reject`)
            .set(ADMIN)
            .send({ reason: "x" });
        expect(res.status).toBe(400);
    });
});

describe("POST /api/admin/scrape/staging/:id/approve", () => {
    it("approves and creates a published JobV2 + matches company", async () => {
        const s = await makeStagingJob({
            jobData: {
                title: "Approved Job",
                applyLink: "https://example.com/approved",
                displayMode: "external_redirect",
                employmentType: ["FULL_TIME"],
                batch: [2024],
                companyName: "ApproveCo",
            },
            companyData: { companyName: "ApproveCo" },
        });

        const res = await request(app)
            .post(`/api/admin/scrape/staging/${s._id}/approve`)
            .set(ADMIN)
            .send({});

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe("published");

        const job = await JobV2.findById(res.body.data._id);
        expect(job).toBeTruthy();

        const company = await CompanyV2.findById(job.company);
        expect(company.companyName).toBe("ApproveCo");

        const fresh = await StagingJob.findById(s._id);
        expect(fresh.status).toBe("approved");
    });

    it("blocks approving an already-rejected job (400)", async () => {
        const s = await makeStagingJob({ status: "rejected" });
        const res = await request(app)
            .post(`/api/admin/scrape/staging/${s._id}/approve`)
            .set(ADMIN)
            .send({});
        expect(res.status).toBe(400);
    });
});

describe("DELETE /api/admin/scrape/staging/:id", () => {
    it("deletes staging row", async () => {
        const s = await makeStagingJob();
        const res = await request(app).delete(`/api/admin/scrape/staging/${s._id}`).set(ADMIN);
        expect(res.status).toBe(200);

        const after = await StagingJob.findById(s._id);
        expect(after).toBeNull();
    });
});

describe("GET /api/admin/scrape/health", () => {
    it("returns empty state when no logs", async () => {
        const res = await request(app).get("/api/admin/scrape/health").set(ADMIN);
        expect(res.status).toBe(200);
        expect(res.body.adapters).toEqual([]);
    });

    it("returns adapter health from latest log", async () => {
        await ScrapeLog.create({
            runId: "run-1",
            startedAt: new Date(),
            trigger: "manual",
            aiProvider: "gemini",
            adapters: [
                {
                    name: "test-adapter",
                    status: "success",
                    jobLinksFound: 5,
                    jobsFetched: 5,
                    jobsTransformed: 5,
                    jobsIngested: 3,
                    jobsSkipped: 2,
                    errors: [],
                    durationMs: 1234,
                },
            ],
        });

        const res = await request(app).get("/api/admin/scrape/health").set(ADMIN);
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].name).toBe("test-adapter");
        expect(res.body.data[0].status).toBe("success");
    });
});

describe("GET /api/admin/scrape/logs", () => {
    it("returns recent logs", async () => {
        await ScrapeLog.create({ runId: "run-2", startedAt: new Date(), trigger: "manual" });
        const res = await request(app).get("/api/admin/scrape/logs").set(ADMIN);
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
    });
});
