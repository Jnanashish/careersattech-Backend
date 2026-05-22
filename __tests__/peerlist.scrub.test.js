const { scrubText, scrubRecord, containsSourceHost } = require("../src/modules/scraper/peerlist/scrub");

describe("scrubText", () => {
    test("removes Peerlist mentions case-insensitively", () => {
        expect(scrubText("Posted on Peerlist by ACME")).not.toMatch(/peerlist/i);
        expect(scrubText("via PEERLIST")).not.toMatch(/peerlist/i);
        expect(scrubText("hired via Peerlist to build the future")).not.toMatch(/peerlist/i);
    });

    test("collapses extra whitespace from removals", () => {
        const out = scrubText("Find  this  job  on Peerlist  today");
        expect(out).not.toMatch(/  /);
    });

    test("preserves text with no peerlist mention", () => {
        expect(scrubText("Backend engineer at Acme")).toBe("Backend engineer at Acme");
    });

    test("non-string passes through", () => {
        expect(scrubText(null)).toBe(null);
        expect(scrubText(undefined)).toBe(undefined);
    });
});

describe("scrubRecord", () => {
    test("zero peerlist occurrences anywhere", () => {
        const input = {
            title: "Engineer at Peerlist",
            companyName: "Peerlist Inc",
            location: "Bangalore via Peerlist",
            descriptionSnippet: "Posted on Peerlist. Apply via Peerlist.",
            compensation: "10 LPA on Peerlist",
            skills: ["React", "Peerlist culture"],
            applyUrl: "https://acme.example.com/jobs/x",
        };
        const out = scrubRecord(input);
        for (const v of [out.title, out.companyName, out.location, out.descriptionSnippet, out.compensation]) {
            expect(v.toLowerCase()).not.toContain("peerlist");
        }
        for (const s of out.skills) {
            expect(s.toLowerCase()).not.toContain("peerlist");
        }
    });
});

describe("containsSourceHost", () => {
    test("detects peerlist hosts in URLs", () => {
        expect(containsSourceHost("https://peerlist.io/r/x")).toBe(true);
        expect(containsSourceHost("https://www.peerlist.io/jobs/x")).toBe(true);
        expect(containsSourceHost("https://acme.com/jobs/x")).toBe(false);
    });
});
