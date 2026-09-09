require("./setup");

const { hostOf, isSameSite, pointsAtSourceSite } = require("../src/modules/scraper/sourceHost");
const { FULL_PROMPT, JOB_ONLY_PROMPT } = require("../src/modules/scraper/transformer");
const { validatePublishReadiness } = require("../src/modules/scraper/publisher");

// The bug this guards: the transformer LLM chooses applyLink, and on sources
// where every candidate is a bare URL with nothing in the body text to
// identify it, it sometimes answers with the aggregator's own permalink. Three
// FrontendGeek jobs went live with an Apply button that looped back to
// frontendgeek.com even though the scrape had captured the real LinkedIn
// apply URL on companyPageUrl.

describe("sourceHost helpers", () => {
    test("hostOf accepts full URLs and bare hosts, strips www", () => {
        expect(hostOf("https://www.frontendgeek.com/frontend-jobs/explore")).toBe("frontendgeek.com");
        expect(hostOf("frontendgeek.com")).toBe("frontendgeek.com");
        expect(hostOf("https://www.talentd.in/jobs")).toBe("talentd.in");
    });

    test("hostOf returns '' for hostless or unparseable values", () => {
        // mailto: applyLinks are legitimate and carry no host — they must never
        // be mistaken for a match against some source.
        expect(hostOf("mailto:careers@frontendgeek.com")).toBe("");
        expect(hostOf("")).toBe("");
        expect(hostOf(null)).toBe("");
        expect(hostOf(undefined)).toBe("");
        expect(hostOf(42)).toBe("");
    });

    test("isSameSite matches subdomains in both directions", () => {
        expect(isSameSite("api.peerlist.io", "peerlist.io")).toBe(true);
        expect(isSameSite("peerlist.io", "api.peerlist.io")).toBe(true);
        expect(isSameSite("peerlist.io", "peerlist.io")).toBe(true);
        expect(isSameSite("notpeerlist.io", "peerlist.io")).toBe(false);
    });

    test("pointsAtSourceSite flags the aggregator's own permalink", () => {
        expect(
            pointsAtSourceSite(
                "https://frontendgeek.com/frontend-jobs/view/senior-frontend-engineer-at-zoca-7b53637e",
                "frontendgeek.com"
            )
        ).toBe(true);
    });

    test("pointsAtSourceSite allows an outbound job-board apply URL", () => {
        // LinkedIn is an aggregator too, but it is not OUR source — it is the
        // only apply link FrontendGeek offers, so it is the right answer.
        expect(
            pointsAtSourceSite("https://www.linkedin.com/jobs/view/4462801584/", "frontendgeek.com")
        ).toBe(false);
    });

    test("an unknown sourceHost never rejects a link", () => {
        // Fail-open: staging rows written before sourceHost existed carry no
        // value, and a missing field must not start blocking publishes.
        expect(pointsAtSourceSite("https://frontendgeek.com/x", undefined)).toBe(false);
        expect(pointsAtSourceSite("https://frontendgeek.com/x", "")).toBe(false);
    });
});

describe("transformer prompt: applyLink source rule", () => {
    test("both variants rule out sourceHost and bless an outbound job board", () => {
        for (const prompt of [FULL_PROMPT, JOB_ONLY_PROMPT]) {
            expect(prompt).toContain("MUST NOT be on `sourceHost`");
            expect(prompt).toMatch(/LinkedIn is the correct answer when it is the only apply link/);
            // The rule that caused the bug: LinkedIn was the only candidate,
            // and a blanket "never the aggregator URL" excluded it too, so the
            // model broke the tie by echoing the permalink.
            expect(prompt).not.toContain("NEVER the aggregator URL");
        }
    });

    test("both variants explain that field names do not fix URL meaning", () => {
        for (const prompt of [FULL_PROMPT, JOB_ONLY_PROMPT]) {
            expect(prompt).toContain("`sourceHost` is the site this posting was scraped from");
            expect(prompt).toMatch(/never by which field it arrived in/);
        }
    });
});

describe("publish gate: applyLink must leave the source site", () => {
    const publishable = (applyLink) => ({
        title: "Senior Frontend Engineer",
        company: "000000000000000000000001",
        companyName: "Zoca",
        applyLink,
        employmentType: ["FULL_TIME"],
        batch: [2024, 2025, 2026],
        datePosted: new Date(),
        slug: "senior-frontend-engineer-zoca",
        displayMode: "external_redirect",
        status: "published",
    });

    test("rejects a job whose applyLink loops back to the scraped board", () => {
        const errors = validatePublishReadiness(
            publishable("https://frontendgeek.com/frontend-jobs/view/senior-frontend-engineer-at-zoca"),
            { sourceHost: "frontendgeek.com" }
        );
        expect(errors).toContainEqual({
            path: "applyLink",
            message: "applyLink points back at the source site (frontendgeek.com) instead of the employer",
        });
    });

    test("accepts the outbound apply URL the adapter actually extracted", () => {
        const errors = validatePublishReadiness(
            publishable("https://www.linkedin.com/jobs/view/4462801584/"),
            { sourceHost: "frontendgeek.com" }
        );
        expect(errors).toEqual([]);
    });

    test("adapters whose sourceUrl IS the apply link still publish", () => {
        // engineerhub and peerlist read a structured API and set sourceUrl to
        // the employer's apply link. Gating on the host of sourceUrl would
        // reject every job they produce; gating on the adapter's baseUrl host
        // does not.
        const errors = validatePublishReadiness(
            publishable("https://jobs.ashbyhq.com/acme/apply"),
            { sourceHost: "engineerhub.in" }
        );
        expect(errors).toEqual([]);
    });

    test("legacy staging rows without sourceHost are not blocked", () => {
        expect(
            validatePublishReadiness(publishable("https://frontendgeek.com/frontend-jobs/view/x"), {})
        ).toEqual([]);
        expect(
            validatePublishReadiness(publishable("https://frontendgeek.com/frontend-jobs/view/x"))
        ).toEqual([]);
    });
});

describe("scrapeOne stamps sourceHost on every raw job", () => {
    const { scrapeOne } = require("../src/modules/scraper/scraper.fetch");

    test("custom-scrape adapters are stamped too, so none can forget it", async () => {
        // engineerhub, onlyfrontendjobs and peerlist build their own raw jobs
        // from an API. Stamping in scrapeOne rather than in each adapter is
        // what keeps the guard from depending on adapter authors remembering.
        const adapter = {
            name: "fake",
            displayName: "Fake",
            baseUrl: "https://www.example-board.com/jobs",
            enabled: true,
            scrape: async () => ({
                jobs: [{ source: "fake", sourceUrl: "https://acme.com/apply" }],
                stats: { jobLinksFound: 1, jobsFetched: 1, errors: [] },
            }),
        };

        const { jobs } = await scrapeOne(adapter);
        expect(jobs[0].sourceHost).toBe("example-board.com");
        // The rest of the adapter's output is passed through untouched.
        expect(jobs[0].sourceUrl).toBe("https://acme.com/apply");
    });

    test("an adapter may still declare its own sourceHost", async () => {
        const adapter = {
            name: "fake",
            displayName: "Fake",
            baseUrl: "https://api.example-board.com/v1/jobs",
            enabled: true,
            scrape: async () => ({
                jobs: [{ source: "fake", sourceHost: "example-board.com" }],
                stats: { jobLinksFound: 1, jobsFetched: 1, errors: [] },
            }),
        };

        const { jobs } = await scrapeOne(adapter);
        expect(jobs[0].sourceHost).toBe("example-board.com");
    });
});
