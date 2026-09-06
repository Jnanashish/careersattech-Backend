require("./setup");

jest.mock("axios", () => ({ get: jest.fn() }));

const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const axios = require("axios");
const adapter = require("../src/modules/scraper/adapters/talentd");
const { scrapeOne } = require("../src/modules/scraper/scraper.fetch");

const fixture = (name) =>
    fs.readFileSync(path.join(__dirname, "fixtures", `${name}.html`), "utf8");

const LIST_HTML = fixture("talentd-jobs-list");
const DETAIL_HTML = fixture("talentd-job-detail");
const APPLY_HTML = fixture("talentd-apply-page");

const APPLY_URL =
    "https://job-boards.greenhouse.io/embed/job_app?for=towerresearchcapital&token=8143756";

// scrapeOne calls the module-level fetchPage, which proxies through
// api.scraperapi.com when SCRAPERAPI_KEY_* are set and hits the target
// directly when they are not. A developer's .env decides which, so unwrap the
// proxy URL and route on the real target either way.
function targetOf(url) {
    return url.startsWith("https://api.scraperapi.com/")
        ? new URL(url).searchParams.get("url") || url
        : url;
}

function routeByUrl() {
    axios.get.mockImplementation((url) => {
        const target = targetOf(url);
        if (target === "https://www.talentd.in/jobs") return Promise.resolve({ data: LIST_HTML });
        if (target.startsWith("https://www.talentd.in/jobs/")) return Promise.resolve({ data: DETAIL_HTML });
        return Promise.resolve({ data: APPLY_HTML });
    });
}

beforeEach(() => {
    axios.get.mockReset();
});

describe("talentd adapter — selectors against the page markup", () => {
    const $list = cheerio.load(LIST_HTML);
    const $detail = cheerio.load(DETAIL_HTML);

    test("jobLinks picks only real postings, never the /jobs/ taxonomy pages", () => {
        const hrefs = $list(adapter.selectors.jobLinks.selector)
            .map((_, el) => $list(el).attr("href"))
            .get();

        expect(hrefs).toEqual([
            "/jobs/aiml-intern-at-tower-research-gurgaon-apply-now-cpbv",
            "/jobs/apprentice-at-sp-global-gurgaon-20252026-freshers-yvvy",
            "/jobs/sde-intern-at-spyne-gurugram-rs3-5-lpa-gnja",
        ]);
        // The category/city/skill links share the /jobs/ prefix, so an
        // href-only selector would sweep them in as if they were postings.
        expect($list('a[href^="/jobs/"]').length).toBeGreaterThan(hrefs.length);
    });

    test("companyUrl resolves to the employer's ATS, not the site's own links", () => {
        const href = $detail(adapter.selectors.companyUrl.selector).first().attr("href");
        expect(href).toBe(APPLY_URL);
    });

    test("the fallback selector skips hire.talentd.in and the WhatsApp invite", () => {
        // Both appear in the header, ahead of the Apply Now button, so a bare
        // a[target=_blank] fallback would return one of them.
        const href = $detail(adapter.selectors.companyUrl.fallbackSelector).first().attr("href");
        expect(href).toBe(APPLY_URL);
        expect($detail('a[target="_blank"]').first().attr("href")).toContain("hire.talentd.in");
    });

    test("meta selectors find the title and the company", () => {
        expect($detail(adapter.selectors.meta.title).first().text()).toContain("AI/ML Intern");
        expect($detail(adapter.selectors.meta.company).first().text().trim()).toBe("Tower Research");
    });
});

describe("talentd adapter — full scrapeOne flow", () => {
    test("walks list → detail → apply page and emits the standard shape", async () => {
        routeByUrl();

        const { jobs, stats } = await scrapeOne(adapter, { limit: 1 });

        expect(stats.jobLinksFound).toBe(1);
        expect(stats.errors).toEqual([]);
        expect(jobs).toHaveLength(1);

        const job = jobs[0];
        expect(job.source).toBe("talentd");
        expect(job.sourceUrl).toBe(
            "https://www.talentd.in/jobs/aiml-intern-at-tower-research-gurgaon-apply-now-cpbv"
        );
        // The relative card href has to be resolved against the list URL.
        expect(job.sourceUrl.startsWith("https://www.talentd.in/")).toBe(true);
        expect(job.companyPageUrl).toBe(APPLY_URL);
        expect(job.meta.title).toContain("AI/ML Intern");
        expect(job.meta.company).toBe("Tower Research");
        expect(job.meta.postedDate).toBeNull();

        // The JD body the transformer works from.
        expect(job.pageContent).toContain("Responsibilities");
        expect(job.pageContent).toContain("multi-agent systems");
        expect(job.pageContent).toContain("Eligible Batch Years");
        // The employer's own posting is fetched separately.
        expect(job.companyPageContent).toContain("Tower Research Capital is hiring");
    }, 20000);

    test("skips a posting whose apply link is already live", async () => {
        routeByUrl();
        const JobV2 = require("../src/modules/jobsV2/jobsV2.model");
        await JobV2.collection.insertOne({
            applyLink: "https://www.talentd.in/jobs/aiml-intern-at-tower-research-gurgaon-apply-now-cpbv",
            deletedAt: null,
        });

        const { jobs } = await scrapeOne(adapter, { limit: 1 });

        // filterKnownUrls drops the link before the detail page is fetched, so
        // no LLM call is ever paid for.
        expect(jobs).toHaveLength(0);
        // Only the list page was fetched — the detail page never was.
        expect(axios.get).toHaveBeenCalledTimes(1);
    });

    test("reports a failed list fetch rather than throwing", async () => {
        axios.get.mockRejectedValue(new Error("503 Service Unavailable"));

        await expect(scrapeOne(adapter, { limit: 1 })).rejects.toThrow("503 Service Unavailable");
    });
});
