jest.mock("axios");
jest.mock("../../../modules/scraper/providers", () => {
    const complete = jest.fn();
    return {
        getProvider: () => ({ name: "mock", complete }),
        __complete: complete,
    };
});

require("../../../../__tests__/setup");

const axios = require("axios");
const providers = require("../../../modules/scraper/providers");
const JobV2 = require("../../../modules/jobsV2/jobsV2.model");
const CompanyV2 = require("../../../modules/companiesV2/companiesV2.model");
const { scrapeAndCreateJob } = require("../index");
const { FetchBlockedError } = require("../fetchHtml");
const { ExtractionFailedError } = require("../extractJobFields");

const URL = "https://example.com/jobs/abc";

const FULL_HTML = `<!DOCTYPE html><html><body>
<article itemtype="https://schema.org/JobPosting">
<h1>Senior Backend Engineer</h1>
<p>Acme Corp · Bangalore</p>
<p>${"Build distributed systems. ".repeat(50)}</p>
</article></body></html>`;

const FULL_LLM = {
    title: "Senior Backend Engineer",
    companyName: "Acme Corp",
    employmentType: ["FULL_TIME"],
    batch: [2026, 2025, 2024],
    jobDescription: {
        html: "<p>" + "Build distributed systems. ".repeat(40) + "</p>",
        plain: "Build distributed systems. ".repeat(40),
    },
    workMode: "onsite",
    category: "engineering",
    jobLocation: [{ city: "Bangalore", region: "Karnataka", country: "IN" }],
    baseSalary: { currency: "INR", min: 2500000, max: 3500000, unitText: "YEAR" },
    requiredSkills: ["node.js", "mongodb"],
    datePosted: "2026-04-10",
};

function mockFetchOk(html = FULL_HTML) {
    axios.get.mockResolvedValueOnce({
        status: 200,
        data: html,
        headers: { "content-type": "text/html" },
        request: { res: { responseUrl: URL } },
    });
}

beforeEach(() => {
    axios.get.mockReset();
    providers.__complete.mockReset();
});

describe("scrapeAndCreateJob", () => {
    test("happy path creates job + stub company", async () => {
        mockFetchOk();
        providers.__complete.mockResolvedValueOnce(JSON.stringify(FULL_LLM));

        const r = await scrapeAndCreateJob({ applyLink: URL, postedBy: "admin-uid" });
        expect(r.ok).toBe(true);
        expect(r.job.title).toBe("Senior Backend Engineer");
        expect(r.job.status).toBe("published");
        expect(r.job.source).toBe("scraped");
        expect(r.job.externalJobId).toBe(URL);
        expect(r.companyWasCreated).toBe(true);
        expect(r.confidence).toBe("high");

        const inDb = await JobV2.findById(r.job._id);
        expect(inDb).toBeTruthy();
        expect(inDb.applyLink).toBe(URL);

        const company = await CompanyV2.findById(r.job.company);
        expect(company.companyName).toBe("Acme Corp");
    });

    test("reuses existing company", async () => {
        const existing = await CompanyV2.create({
            companyName: "Acme Corp",
            slug: "acme-corp",
            status: "active",
        });
        mockFetchOk();
        providers.__complete.mockResolvedValueOnce(JSON.stringify(FULL_LLM));

        const r = await scrapeAndCreateJob({ applyLink: URL });
        expect(r.ok).toBe(true);
        expect(r.companyWasCreated).toBe(false);
        expect(String(r.job.company)).toBe(String(existing._id));
    });

    test("DUPLICATE: returns errorCode without re-fetching", async () => {
        const company = await CompanyV2.create({
            companyName: "Dup Co",
            slug: "dup-co",
            status: "active",
        });
        await JobV2.create({
            title: "Existing Job",
            slug: "dup-co-existing-job-aaaaaa",
            company: company._id,
            companyName: "Dup Co",
            displayMode: "external_redirect",
            applyLink: URL,
            employmentType: ["FULL_TIME"],
            batch: [2026],
            status: "published",
        });

        const r = await scrapeAndCreateJob({ applyLink: URL });
        expect(r.ok).toBe(false);
        expect(r.errorCode).toBe("DUPLICATE");
        expect(r.existingJob).toBeTruthy();
        expect(axios.get).not.toHaveBeenCalled();
    });

    test("FetchBlockedError propagates", async () => {
        axios.get.mockResolvedValueOnce({
            status: 403,
            data: "",
            headers: {},
            request: { res: { responseUrl: URL } },
        });
        await expect(scrapeAndCreateJob({ applyLink: URL }))
            .rejects.toBeInstanceOf(FetchBlockedError);
    });

    test("ExtractionFailedError propagates", async () => {
        mockFetchOk();
        providers.__complete.mockResolvedValueOnce("garbage not json");
        await expect(scrapeAndCreateJob({ applyLink: URL }))
            .rejects.toBeInstanceOf(ExtractionFailedError);
    });

    test("VALIDATION_FAILED when title missing", async () => {
        mockFetchOk();
        providers.__complete.mockResolvedValueOnce(JSON.stringify({
            ...FULL_LLM,
            title: "",
        }));
        const r = await scrapeAndCreateJob({ applyLink: URL });
        expect(r.ok).toBe(false);
        expect(r.errorCode).toBe("VALIDATION_FAILED");
    });
});
