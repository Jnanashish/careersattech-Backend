require("./setup");

// The transform-time half of the applyLink guard. normalizeJob is internal, so
// drive it through transform() with a stubbed provider and a stubbed company
// resolver (the real one hits Mongo).
const mockComplete = jest.fn();
jest.mock("../src/modules/scraper/providers", () => ({
    getProvider: () => ({ name: "stub", complete: mockComplete }),
}));
jest.mock("../src/services/jobScrapeFromUrl/resolveCompany", () => ({
    findExistingCompany: jest.fn().mockResolvedValue(null),
}));

const { transform } = require("../src/modules/scraper/transformer");

const PERMALINK =
    "https://frontendgeek.com/frontend-jobs/view/senior-frontend-engineer-at-zoca-7b53637e";
const APPLY_URL = "https://www.linkedin.com/jobs/view/4462801584/";

// Minimal well-formed model output; tests vary only applyLink.
function aiResponse(applyLink) {
    const job = {
        title: "Senior Frontend Engineer",
        displayMode: "external_redirect",
        employmentType: ["FULL_TIME"],
        batch: [2024, 2025, 2026],
        jobDescription: { html: "<h3>About the role</h3><p>Build things.</p>", plain: "Build things." },
    };
    if (applyLink !== undefined) job.applyLink = applyLink;
    return JSON.stringify({ job, company: { companyName: "Zoca" } });
}

// Shaped like what scrapeOne hands the transformer for an HTML-scraped board:
// sourceUrl is the board's permalink, companyPageUrl the outbound apply link.
function rawJob(overrides = {}) {
    return {
        source: "frontendgeek",
        sourceHost: "frontendgeek.com",
        sourceUrl: PERMALINK,
        companyPageUrl: APPLY_URL,
        meta: { title: "Senior Frontend Engineer At Zoca", company: "Zoca", postedDate: null },
        pageContent: "Senior Frontend Engineer at Zoca. React, TypeScript. Bangalore.",
        companyPageContent: null,
        ...overrides,
    };
}

beforeEach(() => {
    mockComplete.mockReset();
});

describe("transform(): applyLink must not point back at the scraped board", () => {
    test("replaces an echoed permalink with the extracted apply URL", async () => {
        mockComplete.mockResolvedValue(aiResponse(PERMALINK));
        const { job } = await transform(rawJob());
        expect(job.applyLink).toBe(APPLY_URL);
        // applyPlatform is derived from the corrected link, not the echoed one.
        expect(job.applyPlatform).toBe("linkedin");
        expect(mockComplete).toHaveBeenCalledTimes(1);
    });

    test("leaves a good applyLink untouched", async () => {
        mockComplete.mockResolvedValue(aiResponse(APPLY_URL));
        const { job } = await transform(rawJob());
        expect(job.applyLink).toBe(APPLY_URL);
    });

    test("a subdomain of the source counts as the source", async () => {
        mockComplete.mockResolvedValue(aiResponse("https://jobs.frontendgeek.com/view/x"));
        const { job } = await transform(rawJob());
        expect(job.applyLink).toBe(APPLY_URL);
    });

    test("a missing applyLink still falls back to the extracted apply URL", async () => {
        mockComplete.mockResolvedValue(aiResponse(undefined));
        const { job } = await transform(rawJob());
        expect(job.applyLink).toBe(APPLY_URL);
    });

    test("fails the job rather than falling back to the permalink", async () => {
        // No outbound URL anywhere: the old fallback chain ended at sourceUrl,
        // which published a job linking back to the board. Now it raises, so
        // the run reports an error instead of shipping a dead-end apply link.
        mockComplete.mockResolvedValue(aiResponse(PERMALINK));
        await expect(transform(rawJob({ companyPageUrl: null }))).rejects.toThrow(
            /Missing required field: job\.applyLink/
        );
        // Three attempts, because a re-roll may well find the link in content.
        expect(mockComplete).toHaveBeenCalledTimes(3);
    }, 20000);

    test("adapters whose sourceUrl IS the apply link are unaffected", async () => {
        // engineerhub sets sourceUrl to the employer's apply URL and
        // companyPageUrl to a homepage. Gating on the host of sourceUrl would
        // reject it; gating on the adapter's own baseUrl host does not.
        const ats = "https://jobs.ashbyhq.com/acme/apply";
        mockComplete.mockResolvedValue(aiResponse(ats));
        const { job } = await transform(
            rawJob({
                source: "engineerhub",
                sourceHost: "engineerhub.in",
                sourceUrl: ats,
                companyPageUrl: "https://acme.com",
            })
        );
        expect(job.applyLink).toBe(ats);
    });

    test("a raw job with no sourceHost keeps the old behaviour", async () => {
        // Nothing to compare against must never mean "reject everything".
        mockComplete.mockResolvedValue(aiResponse(PERMALINK));
        const { job } = await transform(rawJob({ sourceHost: undefined }));
        expect(job.applyLink).toBe(PERMALINK);
    });

    test("sourceHost is handed to the model so the prompt rule can name it", async () => {
        mockComplete.mockResolvedValue(aiResponse(APPLY_URL));
        await transform(rawJob());
        const [, userMessage] = mockComplete.mock.calls[0];
        expect(JSON.parse(userMessage).sourceHost).toBe("frontendgeek.com");
    });
});
