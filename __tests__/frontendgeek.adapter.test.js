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

    test("meta.title reads the h1", () => {
        expect($detail(adapter.selectors.meta.title).first().text()).toContain(
            "Senior Staff Software Engineer"
        );
    });

    test("meta.company reads the posting header, not the site nav or footer", () => {
        expect($detail(adapter.selectors.meta.company).first().text().trim()).toBe("LinkedIn");
        // The :has(h1) anchor is what excludes the site chrome <header>, which
        // comes first in document order and would otherwise win .first().
        expect($detail("header").length).toBeGreaterThan(1);
        // The only /companies/ anchors here are the footer's static nav, which
        // would label every job "Google".
        expect($detail('a[href^="/frontend-jobs/companies/"]').first().text()).toBe("Google");
    });

    test("content.selector resolves to the posting, not the tools mega-menu", () => {
        const { selector } = adapter.selectors.content;
        // The class is shared with the mega-menu and with nested ancestors, so
        // a bare .first() would be wrong — extractPageContent narrows by anchor.
        expect($detail(selector).length).toBeGreaterThan(1);
        const withTitle = $detail(selector).filter(
            (_, el) => $detail(el).find(adapter.selectors.meta.title).length > 0
        );
        expect(withTitle.length).toBeGreaterThan(0);
        expect(withTitle.first().text()).toContain("shared UI infrastructure");
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
        // Carried so the transformer can reject an applyLink that loops back
        // here — this board's apply link is a LinkedIn URL the model has no
        // other way to tell apart from the permalink.
        expect(job.sourceHost).toBe("frontendgeek.com");
        expect(job.sourceUrl).toBe(
            "https://frontendgeek.com/frontend-jobs/view/senior-staff-software-engineer-ui-at-linkedin-8ba76477"
        );
        expect(job.companyPageUrl).toBe(APPLY_URL);
        expect(job.meta.title).toContain("Senior Staff Software Engineer");
        expect(job.meta.company).toBe("LinkedIn");
        expect(job.pageContent).toContain("Responsibilities");
        expect(job.pageContent).toContain("shared UI infrastructure");
        // LinkedIn is login-walled, so the company page is never fetched.
        expect(job.companyPageContent).toBeNull();
    }, 25000);

    test("pageContent carries the posting without the menus, ads or rival jobs", async () => {
        routeByUrl();

        const { jobs } = await scrapeOne(adapter);
        const { pageContent } = jobs[0];

        // The posting survives, title and employer included.
        expect(pageContent).toContain("Senior Staff Software Engineer");
        expect(pageContent).toContain("LinkedIn");
        expect(pageContent).toContain("shared UI infrastructure");

        // The tools mega-menu shares the wrapper class and is dropped anyway.
        expect(pageContent).not.toContain("YouTube to MP3 Converter");
        expect(pageContent).not.toContain("Browse by type");
        // Footer directory backlinks.
        expect(pageContent).not.toContain("Topmate");
        // The related-jobs rail — the reason `remove` exists. These are other
        // employers' descriptions sitting inside the posting wrapper, and the
        // transformer would happily read a company name off one of them.
        expect(pageContent).not.toContain("Barclays");
        expect(pageContent).not.toContain("Appzen");
        // Its now-empty "More related jobs" heading survives — a dozen harmless
        // characters, not worth a second selector that couples to the layout.
        expect(pageContent).not.toContain("Software Engineer-Ui");
        expect(pageContent).not.toContain("Senior Frontend Developer");

        // Whole-page strip is what used to blow the LLM token budget.
        const wholePage = cheerio.load(DETAIL_HTML)("body").text().replace(/\s+/g, " ").trim();
        expect(pageContent.length).toBeLessThan(wholePage.length / 2);
    }, 25000);

    test("the company page fetch is skipped for the login-walled apply host", async () => {
        routeByUrl();

        await scrapeOne(adapter);

        const fetched = axios.get.mock.calls.map(([url]) => targetOf(url));
        expect(fetched).not.toContain(APPLY_URL);
        expect(fetched.some((u) => u.includes("linkedin.com"))).toBe(false);
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
