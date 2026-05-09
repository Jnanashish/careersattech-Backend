const request = require("supertest");

require("./setup");
const createApp = require("./createApp");
const JobV2 = require("../model/jobV2.schema");
const CompanyV2 = require("../model/companyV2.schema");
const JobClickV2 = require("../model/jobClickV2.schema");

let app;

beforeAll(() => {
    app = createApp({ only: ["jobsV2Public"] });
});

async function makePublishedJob(slug, overrides = {}) {
    const company = await CompanyV2.create({
        companyName: "PublicCo",
        slug: "publicco-" + Math.random().toString(36).slice(2, 8),
    });
    return JobV2.create({
        title: "Public Job",
        slug,
        company: company._id,
        companyName: company.companyName,
        displayMode: "external_redirect",
        applyLink: "https://example.com/apply",
        employmentType: ["FULL_TIME"],
        batch: [2024],
        status: "published",
        ...overrides,
    });
}

// Click logging is fire-and-forget; wait briefly for the unawaited inserts to land.
const flushClicks = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("GET /api/jobs/:slug/apply", () => {
    it("returns 404 for unknown slug", async () => {
        const res = await request(app).get("/api/jobs/does-not-exist/apply").redirects(0);
        expect(res.status).toBe(404);
    });

    it("returns 404 when job is not published", async () => {
        await makePublishedJob("draft-slug", { status: "draft" });
        const res = await request(app).get("/api/jobs/draft-slug/apply").redirects(0);
        expect(res.status).toBe(404);
    });

    it("302 redirects to applyLink for published job", async () => {
        await makePublishedJob("published-slug-1", {
            applyLink: "https://example.com/redirect-target",
        });

        const res = await request(app).get("/api/jobs/published-slug-1/apply").redirects(0);
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe("https://example.com/redirect-target");
    });

    it("sets cat_sess cookie on first request", async () => {
        await makePublishedJob("published-slug-2");
        const res = await request(app).get("/api/jobs/published-slug-2/apply").redirects(0);

        const setCookie = res.headers["set-cookie"];
        expect(setCookie).toBeDefined();
        expect(setCookie.join(";")).toMatch(/cat_sess=/);
    });

    it("logs apply_click event and increments stats.applyClicks", async () => {
        const job = await makePublishedJob("published-slug-3");
        await request(app).get("/api/jobs/published-slug-3/apply").redirects(0);
        await flushClicks();

        const events = await JobClickV2.find({ job: job._id });
        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe("apply_click");

        const fresh = await JobV2.findById(job._id);
        expect(fresh.stats.applyClicks).toBe(1);
    });
});

describe("POST /api/jobs/:slug/view", () => {
    it("returns 404 for unknown slug", async () => {
        const res = await request(app).post("/api/jobs/missing/view").send({});
        expect(res.status).toBe(404);
    });

    it("logs detail_view and increments pageViews", async () => {
        const job = await makePublishedJob("view-slug-1");
        const res = await request(app)
            .post("/api/jobs/view-slug-1/view")
            .send({ referrer: "https://google.com" });
        expect(res.status).toBe(200);

        await flushClicks();

        const events = await JobClickV2.find({ job: job._id });
        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe("detail_view");
        expect(events[0].referrer).toBe("https://google.com");

        const fresh = await JobV2.findById(job._id);
        expect(fresh.stats.pageViews).toBe(1);
    });

    it("excludes soft-deleted jobs", async () => {
        await makePublishedJob("view-slug-2", { deletedAt: new Date() });
        const res = await request(app).post("/api/jobs/view-slug-2/view").send({});
        expect(res.status).toBe(404);
    });
});
