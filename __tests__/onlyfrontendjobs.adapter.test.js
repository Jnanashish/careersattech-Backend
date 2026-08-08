require("./setup");

jest.mock("axios", () => ({ get: jest.fn() }));

const axios = require("axios");
const adapter = require("../src/modules/scraper/adapters/onlyfrontendjobs");

const APPLY_URL = "https://jobs.franke.com/job/Bad-Saeckingen-Senior-Frontend-Developer/1421153833/";

// Mirrors a real record from https://www.onlyfrontendjobs.com/api/jobs — note
// there is no `description` key. That absence is what starved the transformer.
const API_JOB = {
    id: 647,
    slug: "senior-frontend-developer-f-m-d--franke-647",
    title: "Senior Frontend Developer (f/m/d)",
    company: "Franke",
    location: "Bad Säckingen, Baden-Württemberg, Germany",
    tech_stack: ["JavaScript", "TypeScript", "React"],
    experience_level: "Senior",
    experience_years: 5,
    job_type: "Remote",
    apply_url: APPLY_URL,
    published_at: "2026-07-31T14:49:02.138Z",
    short_pitch: "Franke is looking for a Senior Frontend Developer to own frontend architecture.",
    status: "published",
};

const JD_SENTENCE = "Drive frontend architectural decisions across modern e-commerce platforms. ".repeat(10);

const APPLY_PAGE_HTML = `<!doctype html><html><head>
    <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title: "Senior Frontend Developer (f/m/d)",
        hiringOrganization: { name: "Franke" },
        datePosted: "2026-07-31",
        description: `<p>${JD_SENTENCE}</p><ul><li>Own the design system</li></ul>`,
    })}</script></head><body></body></html>`;

function mockApi(jobs) {
    axios.get.mockResolvedValue({ data: { success: true, total: jobs.length, jobs } });
}

beforeEach(() => {
    axios.get.mockReset();
});

describe("onlyfrontendjobs adapter — apply-page enrichment", () => {
    test("embeds the company's own posting in pageContent", async () => {
        mockApi([API_JOB]);
        const fetchPageImpl = jest.fn().mockResolvedValue(APPLY_PAGE_HTML);

        const { jobs, stats } = await adapter.scrape({ limit: 5, fetchPageImpl });

        expect(jobs).toHaveLength(1);
        expect(fetchPageImpl).toHaveBeenCalledWith(APPLY_URL, {});
        expect(stats.applyPagesFetched).toBe(1);
        expect(stats.applyPagesMissed).toBe(0);

        const { pageContent } = jobs[0];
        expect(pageContent).toContain("OFFICIAL JOB POSTING");
        expect(pageContent).toContain("Drive frontend architectural decisions");
        expect(pageContent).toContain("- Own the design system");
        expect(pageContent).toContain("Date Posted: 2026-07-31");
        // Metadata must survive alongside the description.
        expect(pageContent).toContain("Job Title: Senior Frontend Developer (f/m/d)");
        expect(pageContent).toContain(`Apply URL: ${APPLY_URL}`);
        expect(pageContent).toContain("Summary: Franke is looking for");
        // 41 words was the starved output that motivated this; a real posting
        // must land far above it.
        expect(pageContent.split(/\s+/).length).toBeGreaterThan(100);
    });

    test("still emits the job when the apply page is unreachable", async () => {
        mockApi([API_JOB]);
        const fetchPageImpl = jest.fn().mockRejectedValue(new Error("403 Forbidden"));

        const { jobs, stats } = await adapter.scrape({ limit: 5, fetchPageImpl });

        expect(jobs).toHaveLength(1);
        expect(stats.applyPagesFetched).toBe(0);
        expect(stats.applyPagesMissed).toBe(1);
        expect(jobs[0].pageContent).not.toContain("OFFICIAL JOB POSTING");
        expect(jobs[0].pageContent).toContain("Job Title: Senior Frontend Developer (f/m/d)");
        expect(jobs[0].pageContent).toContain("Summary: Franke is looking for");
    });

    test("declines an unrendered SPA shell rather than feeding it to the LLM", async () => {
        mockApi([API_JOB]);
        const fetchPageImpl = jest.fn().mockResolvedValue('<html><body><div id="root"></div></body></html>');

        const { jobs, stats } = await adapter.scrape({ limit: 5, fetchPageImpl });

        expect(stats.applyPagesMissed).toBe(1);
        expect(jobs[0].pageContent).not.toContain("OFFICIAL JOB POSTING");
    });

    test("keeps the standard adapter output shape", async () => {
        mockApi([API_JOB]);
        const { jobs, stats } = await adapter.scrape({
            limit: 5,
            fetchPageImpl: jest.fn().mockResolvedValue(APPLY_PAGE_HTML),
        });

        expect(jobs[0]).toMatchObject({
            source: "onlyfrontendjobs",
            sourceUrl: "https://www.onlyfrontendjobs.com/jobs/senior-frontend-developer-f-m-d--franke-647",
            companyPageUrl: APPLY_URL,
            companyPageContent: null,
        });
        expect(jobs[0].meta).toEqual({
            title: API_JOB.title,
            company: API_JOB.company,
            postedDate: API_JOB.published_at,
        });
        expect(stats).toHaveProperty("jobLinksFound");
        expect(stats).toHaveProperty("jobsFetched", 1);
        expect(Array.isArray(stats.errors)).toBe(true);
    });

    test("skips records that are not published", async () => {
        mockApi([{ ...API_JOB, status: "draft" }]);
        const fetchPageImpl = jest.fn();

        const { jobs } = await adapter.scrape({ limit: 5, fetchPageImpl });

        expect(jobs).toHaveLength(0);
        expect(fetchPageImpl).not.toHaveBeenCalled();
    });
});
