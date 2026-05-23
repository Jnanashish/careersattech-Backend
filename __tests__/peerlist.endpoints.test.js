require("./setup");

const express = require("express");
const request = require("supertest");
const ScrapeLog = require("../src/modules/scraper/models/scrapeLog.model");
const { clearStop } = require("../src/modules/scraper/stopFlags");
const peerlistAdapter = require("../src/modules/scraper/adapters/peerlist");

// scraper.fetch is required transitively via the admin routes. Mock the
// network-touching primitive so test-adapter/peerlist runs offline.
jest.mock("../src/modules/scraper/scraper.fetch", () => {
    const actual = jest.requireActual("../src/modules/scraper/scraper.fetch");
    return {
        ...actual,
        scrapeOne: jest.fn(async (adapter) => ({
            jobs: [
                {
                    source: adapter.name,
                    sourceUrl: "https://acme.example.com/jobs/abc",
                    companyPageUrl: null,
                    meta: { title: "Software Engineer", company: "Acme", postedDate: null },
                    pageContent: "Job Title: Software Engineer\nApply URL: https://acme.example.com/jobs/abc",
                    companyPageContent: null,
                },
            ],
            stats: { jobLinksFound: 1, jobsFetched: 1, errors: [] },
        })),
    };
});

let app;

beforeAll(() => {
    app = express();
    app.use(express.json({ limit: "1mb" }));
    app.use("/api", require("../src/modules/scraper/scraper.admin.routes"));
});

afterEach(() => {
    clearStop("peerlist");
});

const adminHeaders = { "x-admin-secret": "test-admin-secret" };

describe("peerlist control surface", () => {
    test("GET /admin/scrape/health includes peerlist as idle when no run yet", async () => {
        const res = await request(app).get("/api/admin/scrape/health").set(adminHeaders);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);

        const names = res.body.data.map((a) => a.name).sort();
        expect(names).toEqual(
            expect.arrayContaining(["freshershunt", "offcampusjobs4u", "onlyfrontendjobs", "peerlist"])
        );

        const peer = res.body.data.find((a) => a.name === "peerlist");
        expect(peer).toMatchObject({
            name: "peerlist",
            status: "idle",
            jobsIngested: 0,
            errorCount: 0,
            lastRun: null,
        });
    });

    test("GET /admin/scrape/health shows real values for peerlist after a run", async () => {
        const startedAt = new Date();
        await ScrapeLog.create({
            runId: "test-run-1",
            startedAt,
            completedAt: new Date(),
            trigger: "manual",
            aiProvider: "gemini",
            adapters: [
                {
                    name: "peerlist",
                    status: "success",
                    jobLinksFound: 5,
                    jobsFetched: 3,
                    jobsTransformed: 3,
                    jobsIngested: 2,
                    jobsSkipped: 1,
                    errors: [],
                    durationMs: 1000,
                },
            ],
            summary: {
                totalNew: 2,
                totalSkipped: 1,
                totalErrors: 0,
                adaptersSucceeded: ["peerlist"],
                adaptersFailed: [],
            },
        });

        const res = await request(app).get("/api/admin/scrape/health").set(adminHeaders);
        expect(res.status).toBe(200);
        const peer = res.body.data.find((a) => a.name === "peerlist");
        expect(peer.status).toBe("success");
        expect(peer.jobsIngested).toBe(2);
        expect(peer.errorCount).toBe(0);
        expect(new Date(peer.lastRun).getTime()).toBe(startedAt.getTime());
    });

    test("GET /admin/scrape/health surfaces errorCount on failed peerlist run", async () => {
        await ScrapeLog.create({
            runId: "test-run-2",
            startedAt: new Date(),
            completedAt: new Date(),
            trigger: "cron",
            aiProvider: "gemini",
            adapters: [
                {
                    name: "peerlist",
                    status: "failed",
                    jobLinksFound: 0,
                    jobsFetched: 0,
                    jobsTransformed: 0,
                    jobsIngested: 0,
                    jobsSkipped: 0,
                    errors: [{ jobUrl: "https://peerlist.io/jobs", step: "fetch", message: "boom" }],
                    durationMs: 100,
                },
            ],
            summary: {
                totalNew: 0,
                totalSkipped: 0,
                totalErrors: 1,
                adaptersSucceeded: [],
                adaptersFailed: ["peerlist"],
            },
        });

        const res = await request(app).get("/api/admin/scrape/health").set(adminHeaders);
        const peer = res.body.data.find((a) => a.name === "peerlist");
        expect(peer.status).toBe("failed");
        expect(peer.errorCount).toBe(1);
    });

    test("POST /admin/scrape/test-adapter/peerlist returns adapter result", async () => {
        const res = await request(app).post("/api/admin/scrape/test-adapter/peerlist").set(adminHeaders);
        expect(res.status).toBe(200);
        expect(res.body.adapter).toBe("peerlist");
        expect(res.body.linksFound).toBe(1);
        expect(Array.isArray(res.body.jobs)).toBe(true);
        expect(res.body.jobs[0].title).toBe("Software Engineer");
    });

    test("POST /admin/scrape/stop/peerlist sets stop flag", async () => {
        const res = await request(app).post("/api/admin/scrape/stop/peerlist").set(adminHeaders);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true, adapter: "peerlist" });

        const health = await request(app).get("/api/admin/scrape/health").set(adminHeaders);
        expect(health.body.activeStopRequests).toContain("peerlist");
    });

    test("peerlist adapter is registered (loadable by name even when disabled)", () => {
        expect(peerlistAdapter.name).toBe("peerlist");
    });
});
