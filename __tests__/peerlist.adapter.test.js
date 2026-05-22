require("./setup");

const fs = require("fs");
const path = require("path");
const adapter = require("../src/modules/scraper/adapters/peerlist");

const FIXTURE_PATH = path.join(__dirname, "fixtures", "peerlist-jobs-page-1.html");

function makeFetcher(html) {
    let called = 0;
    return async () => {
        called++;
        if (called === 1) return html;
        return "<html><body><main></main></body></html>";
    };
}

describe("peerlist adapter — contract", () => {
    test("exports the standard adapter shape", () => {
        expect(adapter.name).toBe("peerlist");
        expect(adapter.displayName).toBe("Peerlist");
        expect(typeof adapter.baseUrl).toBe("string");
        expect(typeof adapter.enabled).toBe("boolean");
        expect(typeof adapter.scrape).toBe("function");
        expect(adapter.selectors).toBeDefined();
        expect(adapter.options).toBeDefined();
    });

    test("ships disabled (must be explicitly turned on)", () => {
        expect(adapter.enabled).toBe(false);
    });
});

describe("peerlist adapter — scrape against fixture", () => {
    const html = fs.readFileSync(FIXTURE_PATH, "utf8");

    test("filters India+junior+external; drops USA/senior/peerlist-host; persists no peerlist URLs", async () => {
        const { jobs, stats } = await adapter.scrape({
            limit: 50,
            maxPages: 2,
            fetchPageImpl: makeFetcher(html),
        });

        expect(stats.jobLinksFound).toBeGreaterThanOrEqual(5);
        expect(jobs.length).toBeGreaterThanOrEqual(2);
        expect(jobs.length).toBeLessThanOrEqual(3);

        expect(stats.dropCounts["filter1_apply"]).toBeGreaterThanOrEqual(1);
        expect(stats.dropCounts["filter2_location"]).toBeGreaterThanOrEqual(1);
        expect(stats.dropCounts["filter3_seniority"]).toBeGreaterThanOrEqual(1);

        for (const j of jobs) {
            expect(j.source).toBe("peerlist");
            expect(j.sourceUrl).toMatch(/^https:\/\//);
            expect(j.sourceUrl).not.toMatch(/peerlist\.io/i);
            expect(j.companyPageUrl).toBeNull();
            expect(j.meta).toHaveProperty("title");
            expect(j.meta).toHaveProperty("company");
            expect(j.pageContent.toLowerCase()).not.toContain("peerlist");
            expect(j.pageContent).toContain("Apply URL");
        }
    });

    test("honors limit option", async () => {
        const { jobs } = await adapter.scrape({
            limit: 1,
            maxPages: 2,
            fetchPageImpl: makeFetcher(html),
        });
        expect(jobs.length).toBe(1);
    });

    test("returns standard {jobs, stats} shape", async () => {
        const { jobs, stats } = await adapter.scrape({
            limit: 50,
            maxPages: 1,
            fetchPageImpl: makeFetcher(html),
        });
        expect(Array.isArray(jobs)).toBe(true);
        expect(stats).toHaveProperty("jobLinksFound");
        expect(stats).toHaveProperty("jobsFetched");
        expect(stats).toHaveProperty("errors");
        expect(Array.isArray(stats.errors)).toBe(true);
    });
});
