require("./setup");

jest.mock("axios", () => ({ get: jest.fn() }));

const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const axios = require("axios");
const adapter = require("../src/modules/scraper/adapters/frontendgeek");
const { scrapeOne } = require("../src/modules/scraper/scraper.fetch");

const fixture = (name) =>
    fs.readFileSync(path.join(__dirname, "fixtures", `${name}.html`), "utf8");

const LIST_HTML = fixture("frontendgeek-explore");
const DETAIL_HTML = fixture("frontendgeek-job-detail");
const APPLY_URL = "https://www.linkedin.com/jobs/view/4457061762/";

// fetchPage proxies through api.scraperapi.com when SCRAPERAPI_KEY_* are set
// and hits the target directly when they are not, so route on the real target.
function targetOf(url) {
    return url.startsWith("https://api.scraperapi.com/")
        ? new URL(url).searchParams.get("url") || url
        : url;
}

function routeByUrl() {
    axios.get.mockImplementation((url) => {
        const target = targetOf(url);
        if (target === "https://frontendgeek.com/frontend-jobs/explore") {
            return Promise.resolve({ data: LIST_HTML });
        }
        if (target.startsWith("https://frontendgeek.com/frontend-jobs/view/")) {
            return Promise.resolve({ data: DETAIL_HTML });
        }
        // The apply target is LinkedIn, which blocks server-side fetches in
        // practice; scrapeOne treats that as non-fatal.
        return Promise.reject(new Error("999 Request denied"));
    });
}

beforeEach(() => {
    axios.get.mockReset();
});

describe("frontendgeek adapter — selectors against the page markup", () => {
    const $list = cheerio.load(LIST_HTML);
    const $detail = cheerio.load(DETAIL_HTML);

    test("jobLinks yields one anchor per posting, not the duplicate View job link", () => {
        const hrefs = $list(adapter.selectors.jobLinks.selector)
            .map((_, el) => $list(el).attr("href"))
            .get();

        expect(hrefs).toEqual([
            "/frontend-jobs/view/senior-staff-software-engineer-ui-at-linkedin-8ba76477",
            "/frontend-jobs/view/frontend-react-engineering-lead-at-cognizant-d106313c",
            "/frontend-jobs/view/frontend-sde-3-at-truemeds-c029049a",
            "/frontend-jobs/view/senior-frontend-engineer-at-aerospike-abf4e202",
        ]);
        // Every card renders its href twice; the h3 scope drops the second copy.
        expect($list('a[href^="/frontend-jobs/view/"]').length).toBe(hrefs.length * 2);
    });

    test("jobLinks ignores the company, location and skill hubs", () => {
        const hrefs = $list(adapter.selectors.jobLinks.selector)
            .map((_, el) => $list(el).attr("href"))
            .get();
        expect(hrefs.every((h) => h.startsWith("/frontend-jobs/view/"))).toBe(true);
        expect($list('a[href^="/frontend-jobs/companies/"]').length).toBeGreaterThan(0);
    });

    test("the feed is ordered newest-first, so the head of the list is the latest", () => {
        const times = $list("time")
            .map((_, el) => new Date($list(el).attr("datetime")).getTime())
            .get();
        const descending = [...times].sort((a, b) => b - a);
        expect(times).toEqual(descending);
    });

    test("companyUrl resolves to the employer's apply link", () => {
        expect($detail(adapter.selectors.companyUrl.selector).first().attr("href")).toBe(APPLY_URL);
    });

    test("the fallback cannot pick up the site's own social or directory links", () => {
        expect($detail(adapter.selectors.companyUrl.fallbackSelector).first().attr("href")).toBe(APPLY_URL);
        // A generic "first outbound anchor" fallback would return this instead.
        const naive = $detail('a[target="_blank"][rel="noopener noreferrer"]').first().attr("href");
        expect(naive).toContain("linkedin.com/company/frontendgeek");
        expect(naive).not.toBe(APPLY_URL);
    });

    test("meta.title reads the h1 and company is deliberately unset", () => {
        expect($detail(adapter.selectors.meta.title).first().text()).toContain(
            "Senior Staff Software Engineer"
        );
        // The only /companies/ anchors here are the footer's static nav, which
        // would label every job "Google".
        expect(adapter.selectors.meta.company).toBeNull();
        expect($detail('a[href^="/frontend-jobs/companies/"]').first().text()).toBe("Google");
    });
});

describe("frontendgeek adapter — full scrapeOne flow", () => {
    test("takes only the newest six and walks list → detail → apply", async () => {
        expect(adapter.selectors.jobLinks.limit).toBe(6);
        routeByUrl();

        const { jobs, stats } = await scrapeOne(adapter);

        // The fixture carries four postings, all under the six-job cap.
        expect(stats.jobLinksFound).toBe(4);
        expect(jobs).toHaveLength(4);

        const job = jobs[0];
        expect(job.source).toBe("frontendgeek");
        expect(job.sourceUrl).toBe(
            "https://frontendgeek.com/frontend-jobs/view/senior-staff-software-engineer-ui-at-linkedin-8ba76477"
        );
        expect(job.companyPageUrl).toBe(APPLY_URL);
        expect(job.meta.title).toContain("Senior Staff Software Engineer");
        expect(job.meta.company).toBeNull();
        expect(job.pageContent).toContain("Responsibilities");
        expect(job.pageContent).toContain("shared UI infrastructure");
        // LinkedIn refused the fetch; the job still comes through.
        expect(job.companyPageContent).toBeNull();
    }, 25000);

    test("caps at the limit when the feed carries more than six postings", async () => {
        const $ = cheerio.load(LIST_HTML);
        const card = $("ul li").first();
        const many = cheerio.load(LIST_HTML);
        for (let i = 0; i < 6; i++) {
            const clone = card.clone();
            clone.find("a").attr("href", `/frontend-jobs/view/extra-job-${i}`);
            many("ul").append(clone);
        }
        const bigList = many.html();

        axios.get.mockImplementation((url) => {
            const target = targetOf(url);
            if (target === "https://frontendgeek.com/frontend-jobs/explore") {
                return Promise.resolve({ data: bigList });
            }
            if (target.startsWith("https://frontendgeek.com/frontend-jobs/view/")) {
                return Promise.resolve({ data: DETAIL_HTML });
            }
            return Promise.reject(new Error("999 Request denied"));
        });

        const { jobs, stats } = await scrapeOne(adapter);

        expect(stats.jobLinksFound).toBe(6);
        expect(jobs).toHaveLength(6);
    }, 40000);
});
