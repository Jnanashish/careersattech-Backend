const request = require("supertest");

require("./setup");
const createApp = require("./createApp");
const Jobdesc = require("../model/jobs.schema");
const JobClickEvent = require("../model/jobClickEvent.schema");

let app;
const AUTH = { "x-api-key": "test-secret-key" };

beforeAll(() => {
    app = createApp({ only: ["analytics"] });
});

async function makeJob(overrides = {}) {
    return Jobdesc.create({
        title: "Job",
        link: "https://example.com",
        companyName: "Co",
        isActive: true,
        ...overrides,
    });
}

describe("Analytics auth", () => {
    const endpoints = [
        "/api/analytics/summary",
        "/api/analytics/jobs-over-time",
        "/api/analytics/clicks-over-time",
        "/api/analytics/top-jobs",
        "/api/analytics/jobs-by-category?groupBy=jobtype",
    ];
    test.each(endpoints)("%s requires auth", async (url) => {
        const res = await request(app).get(url);
        expect(res.status).toBe(401);
    });
});

describe("GET /api/analytics/summary", () => {
    it("returns aggregate counts", async () => {
        await makeJob({ title: "Active Job", isActive: true, totalclick: 5 });
        await makeJob({ title: "Inactive Job", isActive: false, totalclick: 3 });

        const res = await request(app).get("/api/analytics/summary").set(AUTH);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.totalJobs).toBe(2);
        expect(res.body.data.activeJobs).toBe(1);
        expect(res.body.data.totalClicks).toBe(8);
    });

    it("respects period param (7d)", async () => {
        const res = await request(app).get("/api/analytics/summary?period=7d").set(AUTH);
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveProperty("jobsAddedInPeriod");
    });
});

describe("GET /api/analytics/jobs-over-time", () => {
    it("returns daily series array", async () => {
        await makeJob();
        const res = await request(app).get("/api/analytics/jobs-over-time?period=7d").set(AUTH);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
        expect(res.body.data[0]).toHaveProperty("jobsAdded");
        expect(res.body.data[0]).toHaveProperty("jobsExpired");
    });
});

describe("GET /api/analytics/clicks-over-time", () => {
    it("aggregates click events", async () => {
        const job = await makeJob();
        await JobClickEvent.create({ jobId: job._id, source: "test", timestamp: new Date() });
        await JobClickEvent.create({ jobId: job._id, source: "test", timestamp: new Date() });

        const res = await request(app).get("/api/analytics/clicks-over-time?period=7d").set(AUTH);
        expect(res.status).toBe(200);
        const totalClicks = res.body.data.reduce((acc, d) => acc + (d.clicks || 0), 0);
        expect(totalClicks).toBe(2);
    });
});

describe("GET /api/analytics/top-jobs", () => {
    it("returns top jobs by total clicks (period=all)", async () => {
        await makeJob({ title: "Most Clicked", totalclick: 100 });
        await makeJob({ title: "Less Clicked", totalclick: 5 });

        const res = await request(app).get("/api/analytics/top-jobs?period=all&limit=5").set(AUTH);
        expect(res.status).toBe(200);
        expect(res.body.data[0].title).toBe("Most Clicked");
    });

    it("clamps limit to 50", async () => {
        const res = await request(app).get("/api/analytics/top-jobs?limit=999").set(AUTH);
        expect(res.status).toBe(200);
        expect(res.body.data.length).toBeLessThanOrEqual(50);
    });
});

describe("GET /api/analytics/jobs-by-category", () => {
    it("rejects missing groupBy (400)", async () => {
        const res = await request(app).get("/api/analytics/jobs-by-category").set(AUTH);
        expect(res.status).toBe(400);
    });

    it("rejects invalid groupBy field (400)", async () => {
        const res = await request(app).get("/api/analytics/jobs-by-category?groupBy=password").set(AUTH);
        expect(res.status).toBe(400);
    });

    it("groups by jobtype", async () => {
        await makeJob({ jobtype: "fulltime" });
        await makeJob({ jobtype: "fulltime" });
        await makeJob({ jobtype: "intern" });

        const res = await request(app).get("/api/analytics/jobs-by-category?groupBy=jobtype").set(AUTH);
        expect(res.status).toBe(200);
        const labels = res.body.data.map((d) => d.label);
        expect(labels).toContain("fulltime");
        expect(labels).toContain("intern");
    });
});
