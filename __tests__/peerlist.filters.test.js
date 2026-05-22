const {
    filter1_apply,
    filter2_location,
    filter3_seniority,
    filter4_identity,
    applyAll,
    parseMinYears,
    titleHasSeniorityTerm,
    locationPasses,
} = require("../src/modules/scraper/peerlist/filters");

describe("filter1_apply", () => {
    const base = { applyUrl: "https://acme.example.com/jobs/123" };

    test("keep external https URL", () => {
        expect(filter1_apply(base).keep).toBe(true);
    });

    test("drop missing applyUrl", () => {
        expect(filter1_apply({ applyUrl: "" }).keep).toBe(false);
        expect(filter1_apply({}).keep).toBe(false);
    });

    test("drop peerlist host", () => {
        expect(filter1_apply({ applyUrl: "https://peerlist.io/r/abc" }).keep).toBe(false);
        expect(filter1_apply({ applyUrl: "https://www.peerlist.io/jobs/x" }).keep).toBe(false);
    });

    test("drop short-link hosts", () => {
        expect(filter1_apply({ applyUrl: "https://bit.ly/abc" }).keep).toBe(false);
        expect(filter1_apply({ applyUrl: "https://lnkd.in/xyz" }).keep).toBe(false);
        expect(filter1_apply({ applyUrl: "https://t.co/foo" }).keep).toBe(false);
    });

    test("drop if button text suggests internal apply", () => {
        const out = filter1_apply({ ...base, applyButtonText: "Apply on Peerlist" });
        expect(out.keep).toBe(false);
    });

    test("drop non-http protocols", () => {
        expect(filter1_apply({ applyUrl: "javascript:alert(1)" }).keep).toBe(false);
        expect(filter1_apply({ applyUrl: "ftp://x.example.com" }).keep).toBe(false);
    });
});

describe("filter2_location", () => {
    test("keep India phrasing", () => {
        for (const loc of ["India", "Bangalore, India", "Remote, India", "Anywhere in India", "Pan India"]) {
            expect(locationPasses(loc)).toBe(true);
        }
    });

    test("keep Indian city alone", () => {
        for (const city of ["Bangalore", "Bengaluru", "Pune", "Hyderabad", "Mumbai", "Delhi"]) {
            expect(locationPasses(city)).toBe(true);
        }
    });

    test("drop bare Remote", () => {
        expect(locationPasses("Remote")).toBe(false);
    });

    test("drop other countries", () => {
        for (const loc of ["San Francisco, USA", "London, UK", "Singapore", "Dubai, UAE", "Berlin, Germany"]) {
            expect(locationPasses(loc)).toBe(false);
        }
    });

    test("drop ambiguous worldwide tokens", () => {
        for (const loc of ["Worldwide", "Global", "Anywhere"]) {
            expect(locationPasses(loc)).toBe(false);
        }
    });

    test("multi-location: keep if any India", () => {
        expect(locationPasses("Singapore / Bangalore")).toBe(true);
        expect(locationPasses("USA / Remote, India")).toBe(true);
    });

    test("drop empty/missing", () => {
        expect(locationPasses("")).toBe(false);
        expect(locationPasses(null)).toBe(false);
        expect(locationPasses(undefined)).toBe(false);
    });

    test("drop bare hybrid", () => {
        expect(locationPasses("Hybrid")).toBe(false);
    });
});

describe("parseMinYears", () => {
    test.each([
        ["Fresher", 0],
        ["Entry-level", 0],
        ["0-2 years", 0],
        ["2-5 yrs", 2],
        ["5-8 years", 5],
        ["6+ years", 6],
        ["6-10 years", 6],
        ["8-12 yrs", 8],
        ["", 0],
        [null, 0],
    ])("%s => %i", (input, expected) => {
        expect(parseMinYears(input)).toBe(expected);
    });
});

describe("titleHasSeniorityTerm", () => {
    test("hits various keywords", () => {
        expect(titleHasSeniorityTerm("Senior Software Engineer")).toBe("senior");
        expect(titleHasSeniorityTerm("Sr. Backend Engineer")).toBe("sr.");
        expect(titleHasSeniorityTerm("Sr Backend Engineer")).toBe("sr");
        expect(titleHasSeniorityTerm("Staff Engineer")).toBe("staff");
        expect(titleHasSeniorityTerm("Principal Architect")).toBe("principal");
        expect(titleHasSeniorityTerm("Engineering Manager")).toBe("manager");
        expect(titleHasSeniorityTerm("VP of Engineering")).toBe("vp");
        expect(titleHasSeniorityTerm("Chief Technology Officer")).toBe("chief");
    });

    test("misses for junior titles", () => {
        expect(titleHasSeniorityTerm("Software Engineer")).toBeNull();
        expect(titleHasSeniorityTerm("Frontend Developer")).toBeNull();
        expect(titleHasSeniorityTerm("Intern - Backend")).toBeNull();
    });
});

describe("filter3_seniority", () => {
    test("keep junior", () => {
        expect(filter3_seniority({ title: "Software Engineer", experienceRange: "0-2 years" }).keep).toBe(true);
    });

    test("drop >5 yrs", () => {
        expect(filter3_seniority({ title: "Engineer", experienceRange: "6+ years" }).keep).toBe(false);
        expect(filter3_seniority({ title: "Engineer", experienceRange: "8-12 yrs" }).keep).toBe(false);
    });

    test("drop senior title even if YOE missing", () => {
        expect(filter3_seniority({ title: "Senior Engineer", experienceRange: "" }).keep).toBe(false);
    });

    test("keep boundary 5-8 (min=5)", () => {
        expect(filter3_seniority({ title: "Engineer", experienceRange: "5-8 years" }).keep).toBe(true);
    });
});

describe("filter4_identity", () => {
    test("drop if peerlist in title", () => {
        expect(filter4_identity({ title: "Engineer at Peerlist", companyName: "Acme" }).keep).toBe(false);
    });

    test("drop if peerlist is company", () => {
        expect(filter4_identity({ title: "Engineer", companyName: "Peerlist" }).keep).toBe(false);
    });

    test("keep regular jobs", () => {
        expect(filter4_identity({ title: "Engineer", companyName: "Acme" }).keep).toBe(true);
    });
});

describe("applyAll fail-fast", () => {
    test("first failing filter reports first", () => {
        const record = {
            applyUrl: "https://peerlist.io/r/x",
            location: "USA",
            experienceRange: "10 years",
            title: "Senior Engineer at Peerlist",
            companyName: "Peerlist",
        };
        expect(applyAll(record).reason).toBe("filter1_apply");
    });

    test("all clean records pass", () => {
        const record = {
            applyUrl: "https://acme.example.com/jobs/123",
            location: "Bangalore, India",
            experienceRange: "0-2 years",
            title: "Software Engineer",
            companyName: "Acme",
        };
        expect(applyAll(record).keep).toBe(true);
    });
});
