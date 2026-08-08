const {
    fetchApplyPageContent,
    buildApplyPageContent,
    extractJobPostingLd,
    htmlToText,
    MIN_USEFUL_CONTENT,
} = require("../src/modules/scraper/applyPageContent");

const LONG_BODY = "Own the frontend architecture and ship performant e-commerce experiences. ".repeat(12);

function ldPage(node, { bodyText = "" } = {}) {
    return `<!doctype html><html><head>
        <script type="application/ld+json">${JSON.stringify(node)}</script>
        </head><body><div id="root">${bodyText}</div></body></html>`;
}

const JOB_POSTING = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "Senior Frontend Developer",
    hiringOrganization: { "@type": "Organization", name: "Franke" },
    employmentType: ["FULL_TIME"],
    datePosted: "2026-07-31",
    validThrough: "2026-09-30",
    jobLocationType: "TELECOMMUTE",
    jobLocation: [
        { "@type": "Place", address: { addressLocality: "Bengaluru", addressRegion: "Karnataka", addressCountry: "IN" } },
    ],
    baseSalary: {
        "@type": "MonetaryAmount",
        currency: "INR",
        value: { "@type": "QuantitativeValue", minValue: 1800000, maxValue: 2600000, unitText: "YEAR" },
    },
    description: `<p>${LONG_BODY}</p><h3>What you&#39;ll do</h3><ul><li>Drive architecture</li><li>Mentor engineers</li></ul>`,
};

describe("htmlToText", () => {
    test("keeps list items on separate lines instead of gluing them together", () => {
        const text = htmlToText("<ul><li>Drive architecture</li><li>Mentor engineers</li></ul>");
        expect(text).toContain("- Drive architecture");
        expect(text).toContain("- Mentor engineers");
        expect(text).not.toContain("Drive architectureMentor");
    });

    test("decodes entities and drops nav/footer chrome", () => {
        const text = htmlToText(
            "<body><nav>Home Jobs Login</nav><p>What you&#39;ll do</p><footer>Cookies</footer></body>"
        );
        expect(text).toContain("What you'll do");
        expect(text).not.toContain("Home Jobs Login");
        expect(text).not.toContain("Cookies");
    });

    test("tolerates null and undefined", () => {
        expect(htmlToText(null)).toBe("");
        expect(htmlToText(undefined)).toBe("");
    });
});

describe("extractJobPostingLd", () => {
    test("finds a bare JobPosting node", () => {
        expect(extractJobPostingLd(ldPage(JOB_POSTING)).title).toBe("Senior Frontend Developer");
    });

    test("finds a JobPosting nested in @graph", () => {
        const page = ldPage({ "@context": "https://schema.org", "@graph": [{ "@type": "WebPage" }, JOB_POSTING] });
        expect(extractJobPostingLd(page).title).toBe("Senior Frontend Developer");
    });

    test("finds a JobPosting in a top-level array", () => {
        const page = ldPage([{ "@type": "Organization", name: "Franke" }, JOB_POSTING]);
        expect(extractJobPostingLd(page).title).toBe("Senior Frontend Developer");
    });

    test("prefers the node with the longest description when several exist", () => {
        const page = `<html><head>
            <script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", title: "Stub", description: "short" })}</script>
            <script type="application/ld+json">${JSON.stringify(JOB_POSTING)}</script>
        </head><body></body></html>`;
        expect(extractJobPostingLd(page).title).toBe("Senior Frontend Developer");
    });

    test("ignores malformed JSON-LD instead of throwing", () => {
        const page = '<html><head><script type="application/ld+json">{"@type":"JobPosting",</script></head><body></body></html>';
        expect(extractJobPostingLd(page)).toBeNull();
    });

    test("returns null when the page has no JobPosting", () => {
        expect(extractJobPostingLd("<html><body><p>hello</p></body></html>")).toBeNull();
    });
});

describe("buildApplyPageContent", () => {
    test("prefers JSON-LD and carries the Google-for-Jobs fields through", () => {
        const result = buildApplyPageContent(ldPage(JOB_POSTING));
        expect(result.extractedFrom).toBe("jsonld");
        expect(result.text).toContain("Job Title: Senior Frontend Developer");
        expect(result.text).toContain("Company: Franke");
        expect(result.text).toContain("Date Posted: 2026-07-31");
        expect(result.text).toContain("Valid Through: 2026-09-30");
        expect(result.text).toContain("Location: Bengaluru, Karnataka, IN");
        expect(result.text).toContain("Work Mode: Remote");
        expect(result.text).toContain("INR 1800000 - 2600000 per year");
        expect(result.text).toContain("- Drive architecture");
    });

    test("falls back to page text when JSON-LD is absent", () => {
        const result = buildApplyPageContent(`<html><body><main><p>${LONG_BODY}</p></main></body></html>`);
        expect(result.extractedFrom).toBe("html");
        expect(result.text).toContain("Own the frontend architecture");
    });

    test("falls back to page text when the JSON-LD description is too thin", () => {
        const page = ldPage(
            { "@type": "JobPosting", title: "Senior Frontend Developer", description: "TBD" },
            { bodyText: `<p>${LONG_BODY}</p>` }
        );
        const result = buildApplyPageContent(page);
        expect(result.extractedFrom).toBe("html");
        expect(result.text).toContain("Own the frontend architecture");
    });

    // SuccessFactors (jobs.franke.com) builds its site menu from plain <ul>/<div>,
    // so it sails past a <nav>/<header> strip and lands ~1100 chars of German
    // navigation at the top of the description.
    test("scopes past a menu that is not marked up as nav", () => {
        const page = `<html><body>
            <ul><li>Über Franke</li><li>Nachhaltigkeit</li><li>Karriere</li></ul>
            <div id="content"><p>${LONG_BODY}</p></div>
        </body></html>`;
        const result = buildApplyPageContent(page);
        expect(result.text).toContain("Own the frontend architecture");
        expect(result.text).not.toContain("Nachhaltigkeit");
    });

    // The opposite failure, and the one jobScrapeFromUrl/cleanHtml still has:
    // taking the first <article> on the page even when it is a teaser card.
    test("skips a too-small candidate container instead of returning the teaser", () => {
        const page = `<html><body>
            <article>Related job: Backend Engineer</article>
            <main><p>${LONG_BODY}</p></main>
        </body></html>`;
        const result = buildApplyPageContent(page);
        expect(result.text).toContain("Own the frontend architecture");
        expect(result.text).not.toContain("Related job");
    });

    // Workday, SmartRecruiters and Workable serve an empty SPA shell to a plain
    // HTTP fetch. Publishing a JD written from ~15 chars of chrome is worse than
    // keeping the aggregator metadata, so extraction must decline.
    test("returns null for an unrendered SPA shell", () => {
        expect(buildApplyPageContent('<html><body><div id="root"></div></body></html>')).toBeNull();
    });

    test("returns null when content sits just under the useful threshold", () => {
        const page = `<html><body><p>${"x".repeat(MIN_USEFUL_CONTENT - 1)}</p></body></html>`;
        expect(buildApplyPageContent(page)).toBeNull();
    });

    test("truncates on a word boundary at maxLength", () => {
        const page = `<html><body><p>${LONG_BODY.repeat(20)}</p></body></html>`;
        const full = buildApplyPageContent(page).text;
        const result = buildApplyPageContent(page, { maxLength: 1000 });

        expect(full.length).toBeGreaterThan(1000);
        expect(result.text.length).toBeLessThanOrEqual(1000);
        expect(full.startsWith(result.text)).toBe(true);
        // The character the cut landed on must be whitespace — i.e. no word
        // was sliced in half.
        expect(full[result.text.length]).toMatch(/\s/);
    });
});

describe("fetchApplyPageContent", () => {
    test("returns extracted content via the injected fetcher", async () => {
        const fetchPageImpl = jest.fn().mockResolvedValue(ldPage(JOB_POSTING));
        const result = await fetchApplyPageContent("https://jobs.franke.com/job/123/", { fetchPageImpl });
        expect(fetchPageImpl).toHaveBeenCalledWith("https://jobs.franke.com/job/123/", {});
        expect(result.extractedFrom).toBe("jsonld");
    });

    test("returns null instead of throwing when the fetch fails", async () => {
        const fetchPageImpl = jest.fn().mockRejectedValue(new Error("403 Forbidden"));
        await expect(
            fetchApplyPageContent("https://jobs.example.com/x", { fetchPageImpl })
        ).resolves.toBeNull();
    });

    test("returns null without fetching when there is no apply URL", async () => {
        const fetchPageImpl = jest.fn();
        expect(await fetchApplyPageContent(null, { fetchPageImpl })).toBeNull();
        expect(await fetchApplyPageContent("", { fetchPageImpl })).toBeNull();
        expect(fetchPageImpl).not.toHaveBeenCalled();
    });
});
