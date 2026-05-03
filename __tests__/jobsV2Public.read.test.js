const request = require("supertest");

require("./setup");
const express = require("express");
const JobV2 = require("../model/jobV2.schema");
const CompanyV2 = require("../model/companyV2.schema");

let app;

beforeAll(() => {
    app = express();
    app.use(express.json({ limit: "1mb" }));
    app.use("/api/jobs/v2", require("../routes/public/jobsV2Public.routes"));
    app.use("/api/companies/v2", require("../routes/public/companiesV2Public.routes"));
});

async function makeCompany(overrides = {}) {
    const suffix = Math.random().toString(36).slice(2, 8);
    return CompanyV2.create({
        companyName: overrides.companyName || `Co-${suffix}`,
        slug: overrides.slug || `co-${suffix}`,
        status: "active",
        ...overrides,
    });
}

async function makeJob(slug, company, overrides = {}) {
    return JobV2.create({
        title: "Engineer",
        slug,
        company: company._id,
        companyName: company.companyName,
        displayMode: "external_redirect",
        applyLink: "https://example.com/apply",
        employmentType: ["FULL_TIME"],
        batch: [2025],
        status: "published",
        datePosted: new Date(),
        validThrough: new Date(Date.now() + 30 * 86400000),
        ...overrides,
    });
}

describe("GET /api/jobs/v2", () => {
    it("returns the standard envelope with default sort", async () => {
        const c = await makeCompany();
        await makeJob("a", c);
        await makeJob("b", c);

        const res = await request(app).get("/api/jobs/v2?limit=10");
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            total: 2,
            page: 1,
            limit: 10,
            hasMore: false,
        });
        expect(Array.isArray(res.body.data)).toBe(true);
        expect(res.body.data[0].slug).toBeDefined();
        // jobDescription must NOT be projected on list
        expect(res.body.data[0].jobDescription).toBeUndefined();
        expect(res.body.data[0].seo).toBeUndefined();
    });

    it("excludes draft and soft-deleted jobs", async () => {
        const c = await makeCompany();
        await makeJob("pub", c);
        await makeJob("draft", c, { status: "draft" });
        await makeJob("deleted", c, { deletedAt: new Date() });

        const res = await request(app).get("/api/jobs/v2");
        expect(res.body.total).toBe(1);
        expect(res.body.data[0].slug).toBe("pub");
    });

    it("excludes expired jobs by default but includes them with includeExpired=1", async () => {
        const c = await makeCompany();
        await makeJob("future", c);
        await makeJob("expired", c, { validThrough: new Date(Date.now() - 86400000) });

        const def = await request(app).get("/api/jobs/v2");
        expect(def.body.total).toBe(1);

        const all = await request(app).get("/api/jobs/v2?includeExpired=1");
        expect(all.body.total).toBe(2);
    });

    it("filters by employmentType, workMode, batch, and topicTags", async () => {
        const c = await makeCompany();
        await makeJob("intern-remote", c, {
            employmentType: ["INTERN"],
            workMode: "remote",
            topicTags: ["frontend"],
            batch: [2026],
        });
        await makeJob("ft-onsite", c, {
            employmentType: ["FULL_TIME"],
            workMode: "onsite",
            topicTags: ["backend"],
            batch: [2024],
        });

        let res = await request(app).get("/api/jobs/v2?employmentType=INTERN&workMode=remote");
        expect(res.body.total).toBe(1);
        expect(res.body.data[0].slug).toBe("intern-remote");

        res = await request(app).get("/api/jobs/v2?topicTags=backend");
        expect(res.body.total).toBe(1);
        expect(res.body.data[0].slug).toBe("ft-onsite");

        res = await request(app).get("/api/jobs/v2?batch=2026");
        expect(res.body.total).toBe(1);
    });

    it("filters by company slug", async () => {
        const c1 = await makeCompany({ slug: "alpha-co" });
        const c2 = await makeCompany({ slug: "beta-co" });
        await makeJob("j1", c1);
        await makeJob("j2", c2);

        const res = await request(app).get("/api/jobs/v2?company=alpha-co");
        expect(res.body.total).toBe(1);
        expect(res.body.data[0].slug).toBe("j1");
    });

    it("excludes one slug via exclude param", async () => {
        const c = await makeCompany();
        await makeJob("keep", c);
        await makeJob("skip", c);

        const res = await request(app).get("/api/jobs/v2?exclude=skip");
        expect(res.body.total).toBe(1);
        expect(res.body.data[0].slug).toBe("keep");
    });

    it("ranks sponsorship:desc by tier > priority > datePosted", async () => {
        const c = await makeCompany();
        await makeJob("plain-old", c, { datePosted: new Date(Date.now() - 86400000) });
        await makeJob("featured", c, { sponsorship: { tier: "featured" } });
        await makeJob("sponsored", c, { sponsorship: { tier: "sponsored" } });

        const res = await request(app).get("/api/jobs/v2?sort=sponsorship:desc");
        expect(res.body.data.map((d) => d.slug)).toEqual(["sponsored", "featured", "plain-old"]);
    });
});

describe("GET /api/jobs/v2/:slug", () => {
    it("returns 404 JSON for unknown slug", async () => {
        const res = await request(app).get("/api/jobs/v2/missing-xyz");
        expect(res.status).toBe(404);
        expect(res.body.error).toBe("not_found");
        expect(res.headers["content-type"]).toMatch(/json/);
    });

    it("returns populated company object on detail", async () => {
        const c = await makeCompany({ companyName: "Acme", slug: "acme" });
        await makeJob("hello", c, {
            displayMode: "internal",
            jobDescription: { html: "<p>hi</p>" },
        });

        const res = await request(app).get("/api/jobs/v2/hello");
        expect(res.status).toBe(200);
        expect(res.body.slug).toBe("hello");
        expect(res.body.company.slug).toBe("acme");
        expect(res.body.company.companyName).toBe("Acme");
        expect(res.body.jobDescription.html).toBe("<p>hi</p>");
        expect(res.body.isExpired).toBe(false);
    });

    it("flags expired jobs with isExpired:true but still returns the doc", async () => {
        const c = await makeCompany();
        await makeJob("old", c, { validThrough: new Date(Date.now() - 86400000) });
        const res = await request(app).get("/api/jobs/v2/old");
        expect(res.status).toBe(200);
        expect(res.body.isExpired).toBe(true);
    });
});

describe("GET /api/jobs/v2/by-id/:id", () => {
    it("returns 410 when no v1Id mapping exists", async () => {
        const res = await request(app).get("/api/jobs/v2/by-id/507f1f77bcf86cd799439011");
        expect(res.status).toBe(410);
        expect(res.body.error).toBe("gone");
    });

    it("returns 410 for invalid id format too (never 404)", async () => {
        const res = await request(app).get("/api/jobs/v2/by-id/not-an-id");
        expect(res.status).toBe(410);
    });
});

describe("GET /api/jobs/v2/slugs", () => {
    it("returns every published, non-deleted slug", async () => {
        const c = await makeCompany();
        await makeJob("a", c);
        await makeJob("b", c);
        await makeJob("draft", c, { status: "draft" });

        const res = await request(app).get("/api/jobs/v2/slugs");
        expect(res.status).toBe(200);
        expect(res.body.slugs.sort()).toEqual(["a", "b"]);
    });
});

describe("Tracking endpoints", () => {
    it("POST /track-view returns 204 and increments stats.pageViews", async () => {
        const c = await makeCompany();
        const job = await makeJob("trackme", c);

        const res = await request(app).post("/api/jobs/v2/trackme/track-view");
        expect(res.status).toBe(204);

        // fire-and-forget — wait for the increment to land
        await new Promise((r) => setTimeout(r, 50));
        const fresh = await JobV2.findById(job._id);
        expect(fresh.stats.pageViews).toBe(1);
    });

    it("POST /track-apply returns 204 and increments stats.applyClicks", async () => {
        const c = await makeCompany();
        const job = await makeJob("applyme", c);

        const res = await request(app).post("/api/jobs/v2/applyme/track-apply");
        expect(res.status).toBe(204);

        await new Promise((r) => setTimeout(r, 50));
        const fresh = await JobV2.findById(job._id);
        expect(fresh.stats.applyClicks).toBe(1);
    });

    it("returns 204 silently for an unknown slug", async () => {
        const res = await request(app).post("/api/jobs/v2/unknown-slug/track-view");
        expect(res.status).toBe(204);
    });
});

describe("404 fallback under /api/jobs/v2", () => {
    it("returns JSON 404 for an unknown sub-path", async () => {
        const res = await request(app).get("/api/jobs/v2/foo/bar/baz");
        expect(res.status).toBe(404);
        expect(res.body.error).toBe("not_found");
        expect(res.headers["content-type"]).toMatch(/json/);
    });
});

describe("GET /api/companies/v2", () => {
    it("returns active, non-deleted companies in the standard envelope", async () => {
        await makeCompany({ companyName: "Alpha", slug: "alpha" });
        await makeCompany({ companyName: "Beta", slug: "beta", status: "inactive" });
        await makeCompany({ companyName: "Gamma", slug: "gamma", deletedAt: new Date() });

        const res = await request(app).get("/api/companies/v2");
        expect(res.body.total).toBe(1);
        expect(res.body.data[0].slug).toBe("alpha");
    });

    it("filters by search and companyType", async () => {
        await makeCompany({ companyName: "Stripe", slug: "stripe", companyType: "product" });
        await makeCompany({ companyName: "Accenture", slug: "accenture", companyType: "consulting" });

        const search = await request(app).get("/api/companies/v2?search=str");
        expect(search.body.total).toBe(1);

        const byType = await request(app).get("/api/companies/v2?companyType=consulting");
        expect(byType.body.total).toBe(1);
        expect(byType.body.data[0].slug).toBe("accenture");
    });
});

describe("GET /api/companies/v2/:slug", () => {
    it("returns 404 JSON for unknown slug", async () => {
        const res = await request(app).get("/api/companies/v2/nope");
        expect(res.status).toBe(404);
        expect(res.body.error).toBe("not_found");
    });

    it("includes recentJobs and live openJobsCount", async () => {
        const c = await makeCompany({ companyName: "Zen", slug: "zen" });
        await makeJob("zen-1", c);
        await makeJob("zen-2", c);
        await makeJob("zen-draft", c, { status: "draft" });

        const res = await request(app).get("/api/companies/v2/zen");
        expect(res.status).toBe(200);
        expect(res.body.slug).toBe("zen");
        expect(res.body.recentJobs).toHaveLength(2);
        expect(res.body.stats.openJobsCount).toBe(2);
    });
});

describe("GET /api/companies/v2/slugs", () => {
    it("returns all active, non-deleted slugs", async () => {
        await makeCompany({ slug: "a-co" });
        await makeCompany({ slug: "b-co" });
        await makeCompany({ slug: "c-co", status: "inactive" });

        const res = await request(app).get("/api/companies/v2/slugs");
        expect(res.body.slugs.sort()).toEqual(["a-co", "b-co"]);
    });
});
