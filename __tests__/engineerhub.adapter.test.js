require("./setup");

jest.mock("axios", () => ({ get: jest.fn() }));

const axios = require("axios");
const adapter = require("../src/modules/scraper/adapters/engineerhub");
const StagingJob = require("../src/modules/scraper/models/stagingJob.model");
const { requestStop, clearStop } = require("../src/modules/scraper/stopFlags");

const APPLY_URL = "https://careers.swiggy.com/#/careers?p=abc&reqid=27325";

function isoDaysFromNow(days) {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

// Trimmed from a real getHiringByOpportunityType record — same keys, same
// TinyMCE-authored description with HTML entities and <ul>/<li> structure.
const API_JOB = {
    _id: "6a9c25e4019e034483f6a0f9",
    opportunityType: "Job",
    opportunityName: "Data Scientist I",
    organisationName: "Swiggy",
    organisationLogo: "https://engineerhubs3.s3.ap-south-1.amazonaws.com/backend/company/hiring/swiggy.jpg",
    description:
        "<p>Swiggy is India&rsquo;s pioneering on-demand convenience platform, catering to millions of " +
        "consumers each month. Founded in 2014, its mission is to elevate the quality of life for the " +
        "urban consumer by offering unparalleled convenience across food delivery and quick commerce.</p>" +
        "<p><strong>What will you get to do here?</strong></p>" +
        "<ul><li>Build ML based solutions to improve ads recommendation quality.</li>" +
        "<li>Mine and extract relevant information from historical data.</li>" +
        "<li>Work closely with engineers and PMs on end-to-end inference solutions.</li></ul>",
    mobileNo: 8303156089,
    email: "abc@gmail.com",
    applicationStartTime: "2026-09-05T00:00:00.000Z",
    applicationEndTime: isoDaysFromNow(9),
    showSalary: true,
    salaryDisclosure: "Not Disclosed",
    salaryUnit: "LPA",
    salaryType: "Range",
    minRange: 20,
    maxRange: 30,
    minExperience: 1,
    maxExperience: 3,
    isForFreshers: false,
    openings: null,
    eligibility: null,
    skillsRequired: ["Python", "GenAI", "ML", "SQL"],
    country: "IN",
    state: "KA",
    city: "Bangalore Urban",
    opportunityMode: "Full Time",
    opportunityLocation: "On-Site",
    applyLink: APPLY_URL,
    websiteUrl: "",
    createdAt: "2026-09-05T14:23:32.524Z",
};

function mockApi(records) {
    axios.get.mockResolvedValue({
        data: { success: true, message: "Data has been sent.", data: records, pageSize: records.length },
    });
}

beforeEach(() => {
    axios.get.mockReset();
    clearStop(adapter.name);
});

describe("engineerhub adapter — request shape", () => {
    test("makes exactly one call, page 1 limit 10", async () => {
        mockApi([API_JOB]);

        await adapter.scrape({});

        expect(axios.get).toHaveBeenCalledTimes(1);
        const [url, cfg] = axios.get.mock.calls[0];
        expect(url).toBe("https://backend.engineerhub.in/api/v1/getHiringByOpportunityType/");
        expect(cfg.params).toEqual({ search: "", opportunityType: "Job", pageNo: 1, limit: 10 });
    });
});

describe("engineerhub adapter — mapping", () => {
    test("emits the standard adapter output shape", async () => {
        mockApi([API_JOB]);

        const { jobs, stats } = await adapter.scrape({});

        expect(jobs).toHaveLength(1);
        expect(jobs[0]).toMatchObject({
            source: "engineerhub",
            // The apply link, not a listing permalink: that is what
            // filterKnownUrls matches against JobV2.applyLink.
            sourceUrl: APPLY_URL,
            companyPageUrl: null,
            externalJobId: "engineerhub:6a9c25e4019e034483f6a0f9",
            companyPageContent: null,
        });
        expect(jobs[0].meta).toEqual({
            title: "Data Scientist I",
            company: "Swiggy",
            postedDate: "2026-09-05T14:23:32.524Z",
        });
        expect(stats.jobLinksFound).toBe(1);
        expect(stats.jobsFetched).toBe(1);
        expect(stats.errors).toEqual([]);
    });

    test("carries websiteUrl through as companyPageUrl when present", async () => {
        mockApi([{ ...API_JOB, websiteUrl: "https://www.swiggy.com" }]);

        const { jobs } = await adapter.scrape({});

        expect(jobs[0].companyPageUrl).toBe("https://www.swiggy.com");
    });

    test("builds pageContent with metadata and the full posting body", async () => {
        mockApi([API_JOB]);

        const { jobs } = await adapter.scrape({});
        const { pageContent } = jobs[0];

        expect(pageContent).toContain("Job Title: Data Scientist I");
        expect(pageContent).toContain("Company: Swiggy");
        // District suffix stripped, state code expanded.
        expect(pageContent).toContain("Location: Bangalore, Karnataka, India");
        expect(pageContent).toContain("Job Type: Full Time");
        expect(pageContent).toContain("Work Mode: On-Site");
        expect(pageContent).toContain("Experience Required: 1 - 3 years");
        expect(pageContent).toContain("Skills: Python, GenAI, ML, SQL");
        expect(pageContent).toContain(`Apply URL: ${APPLY_URL}`);
        expect(pageContent).toContain("Application Deadline:");

        // The description is authoritative for this role, so it is headed as
        // the posting rather than as loose metadata.
        expect(pageContent).toContain("OFFICIAL JOB POSTING");
        expect(pageContent).toContain("Swiggy is India\u2019s pioneering on-demand convenience platform");
        expect(pageContent).toContain("- Build ML based solutions to improve ads recommendation quality.");
        expect(pageContent).not.toMatch(/<[a-z/]/i);
        expect(pageContent).not.toContain("&rsquo;");
    });

    test("never leaks the source's contact junk or logo hotlink", async () => {
        mockApi([API_JOB]);

        const { jobs } = await adapter.scrape({});

        expect(jobs[0].pageContent).not.toContain("abc@gmail.com");
        expect(jobs[0].pageContent).not.toContain("8303156089");
        expect(jobs[0].pageContent).not.toContain("engineerhubs3");
    });

    test("labels an undisclosed salary range as the listing's own estimate", async () => {
        mockApi([API_JOB]);

        const { jobs } = await adapter.scrape({});

        expect(jobs[0].pageContent).toContain(
            "Salary (range estimated by the listing, employer did not disclose): 20 - 30 LPA"
        );
    });

    test("presents a disclosed salary range plainly", async () => {
        mockApi([{ ...API_JOB, salaryDisclosure: "Disclosed" }]);

        const { jobs } = await adapter.scrape({});

        expect(jobs[0].pageContent).toContain("Salary: 20 - 30 LPA");
    });

    test("falls back to plain metadata when the description is a stub", async () => {
        mockApi([{ ...API_JOB, description: "<p>Apply now.</p>" }]);

        const { jobs } = await adapter.scrape({});

        // A stub under an "OFFICIAL JOB POSTING" heading would invite the
        // transformer to invent the missing sections.
        expect(jobs[0].pageContent).not.toContain("OFFICIAL JOB POSTING");
        expect(jobs[0].pageContent).toContain("Job Description:\nApply now.");
    });
});

describe("engineerhub adapter — filtering", () => {
    const cases = [
        ["a non-Job opportunity", { opportunityType: "Internship Program" }, "type"],
        ["a posting with no apply link", { applyLink: "" }, "apply"],
        ["a non-HTTPS apply link", { applyLink: "http://careers.example.com/job/1" }, "apply"],
        ["a mailto apply link", { applyLink: "mailto:jobs@example.com" }, "apply"],
        ["an apply link pointing back at the source", { applyLink: "https://engineerhub.in/jobs/1" }, "apply"],
        ["a non-Indian posting", { country: "US" }, "location"],
        ["a senior role", { minExperience: 8, maxExperience: 12 }, "seniority"],
        ["a posting whose window already closed", { applicationEndTime: isoDaysFromNow(-3) }, "expired"],
    ];

    test.each(cases)("drops %s", async (_label, overrides, reason) => {
        mockApi([{ ...API_JOB, ...overrides }]);

        const { jobs, stats } = await adapter.scrape({});

        expect(jobs).toHaveLength(0);
        expect(stats.dropCounts[reason]).toBe(1);
    });

    test("keeps a posting whose deadline is today", async () => {
        const now = new Date();
        const todayUtc = new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
        ).toISOString();
        mockApi([{ ...API_JOB, applicationEndTime: todayUtc }]);

        const { jobs, stats } = await adapter.scrape({});

        expect(jobs).toHaveLength(1);
        expect(stats.dropCounts.expired).toBe(0);
    });

    test("keeps a fresher role at the experience ceiling", async () => {
        mockApi([{ ...API_JOB, minExperience: 5, maxExperience: 7 }]);

        const { jobs } = await adapter.scrape({});

        expect(jobs).toHaveLength(1);
    });
});

describe("engineerhub adapter — dedupe and limits", () => {
    test("skips a posting whose apply link is already staged", async () => {
        await StagingJob.create({ sourceUrl: APPLY_URL, fingerprint: "swiggy_data-scientist-i_bangalore" });
        mockApi([API_JOB]);

        const { jobs, stats } = await adapter.scrape({});

        expect(jobs).toHaveLength(0);
        expect(stats.jobsFetched).toBe(0);
        // Still counted as returned by the API — only the emit is skipped.
        expect(stats.jobLinksFound).toBe(1);
    });

    test("honours the caller's limit", async () => {
        mockApi([
            API_JOB,
            { ...API_JOB, _id: "b2", applyLink: "https://careers.arm.com/job/2" },
            { ...API_JOB, _id: "b3", applyLink: "https://careers.arm.com/job/3" },
        ]);

        const { jobs } = await adapter.scrape({ limit: 2 });

        expect(jobs).toHaveLength(2);
    });

    test("stops before emitting when a stop is requested", async () => {
        requestStop(adapter.name);
        mockApi([API_JOB]);

        const { jobs, stats } = await adapter.scrape({});

        expect(jobs).toHaveLength(0);
        expect(stats.stopped).toBe(true);
        expect(axios.get).not.toHaveBeenCalled();
    });
});

describe("engineerhub adapter — API failures", () => {
    test("records a fetch error instead of throwing", async () => {
        axios.get.mockRejectedValue(new Error("connect ETIMEDOUT"));

        const { jobs, stats } = await adapter.scrape({});

        expect(jobs).toHaveLength(0);
        expect(stats.errors).toHaveLength(1);
        expect(stats.errors[0]).toMatchObject({ step: "fetch", message: "connect ETIMEDOUT" });
    });

    test("records a malformed payload instead of throwing", async () => {
        axios.get.mockResolvedValue({ data: { success: false, data: null } });

        const { jobs, stats } = await adapter.scrape({});

        expect(jobs).toHaveLength(0);
        expect(stats.errors[0].message).toMatch(/unsuccessful or malformed/);
    });
});

describe("engineerhub adapter — htmlToText", () => {
    test("decodes entities and keeps list structure", () => {
        const text = adapter.htmlToText(
            "<p>India&rsquo;s platform</p><ul><li>First point</li><li>Second point</li></ul>"
        );

        expect(text).toBe("India\u2019s platform\n- First point\n- Second point");
    });

    test("returns an empty string for missing or empty HTML", () => {
        expect(adapter.htmlToText(null)).toBe("");
        expect(adapter.htmlToText("   ")).toBe("");
    });
});
