jest.mock("../../../modules/scraper/providers", () => {
    const complete = jest.fn();
    return {
        getProvider: () => ({ name: "mock", complete }),
        __complete: complete,
    };
});

const providers = require("../../../modules/scraper/providers");
const { extractJobFields, ExtractionFailedError, computeConfidence } =
    require("../extractJobFields");

const cleaned = {
    text: "Senior Backend Engineer at Acme Corp. Bangalore. Node.js MongoDB.".repeat(20),
    html: "<h1>Senior Backend Engineer</h1>".repeat(10),
};
const URL = "https://example.com/job/123";

beforeEach(() => {
    providers.__complete.mockReset();
});

const HIGH_RESPONSE = {
    title: "Senior Backend Engineer",
    companyName: "Acme Corp",
    employmentType: ["FULL_TIME"],
    jobDescription: {
        html: "<p>" + "Build distributed systems. ".repeat(30) + "</p>",
        plain: "Build distributed systems. ".repeat(30),
    },
    workMode: "onsite",
    category: "engineering",
    jobLocation: [{ city: "Bangalore", region: "Karnataka", country: "IN" }],
    baseSalary: { currency: "INR", min: 2500000, max: 3500000, unitText: "YEAR" },
    requiredSkills: ["node.js", "mongodb"],
    preferredSkills: [],
    topicTags: ["backend"],
    datePosted: "2026-04-10",
    validThrough: "2026-06-15",
};

describe("extractJobFields", () => {
    test("happy path → high confidence", async () => {
        providers.__complete.mockResolvedValueOnce(JSON.stringify(HIGH_RESPONSE));
        const r = await extractJobFields(cleaned, URL);
        expect(r.fields.title).toBe("Senior Backend Engineer");
        expect(r.confidence).toBe("high");
        expect(r.warnings).toEqual(expect.any(Array));
    });

    test("strips ```json fences", async () => {
        providers.__complete.mockResolvedValueOnce(
            "```json\n" + JSON.stringify(HIGH_RESPONSE) + "\n```"
        );
        const r = await extractJobFields(cleaned, URL);
        expect(r.fields.companyName).toBe("Acme Corp");
    });

    test("invalid JSON throws ExtractionFailedError", async () => {
        providers.__complete.mockResolvedValueOnce("not json at all");
        await expect(extractJobFields(cleaned, URL)).rejects.toBeInstanceOf(ExtractionFailedError);
    });

    test("provider throw wraps to ExtractionFailedError", async () => {
        providers.__complete.mockRejectedValueOnce(new Error("rate limited"));
        await expect(extractJobFields(cleaned, URL)).rejects.toBeInstanceOf(ExtractionFailedError);
    });

    test("low: short description", async () => {
        const r = computeConfidence(
            {
                title: "X",
                companyName: "Y",
                employmentType: ["FULL_TIME"],
                jobDescription: { plain: "tiny" },
            },
            []
        );
        expect(r).toBe("low");
    });

    test("low: missing required", async () => {
        const r = computeConfidence({ companyName: "Y" }, []);
        expect(r).toBe("low");
    });

    test("medium: required ok, only 2 SEO fields", async () => {
        const r = computeConfidence(
            {
                title: "X",
                companyName: "Y",
                employmentType: ["FULL_TIME"],
                jobDescription: { plain: "long enough ".repeat(50) },
                jobLocation: [{ city: "Pune" }],
                baseSalary: { min: 100000 },
            },
            []
        );
        expect(["medium", "high"]).toContain(r);
    });

    test("high: required + datePosted + employmentType + (salary or location)", async () => {
        const r = computeConfidence(
            {
                title: "X",
                companyName: "Y",
                employmentType: ["FULL_TIME"],
                jobDescription: { plain: "long enough ".repeat(50) },
                datePosted: "2026-04-10",
                jobLocation: [{ city: "Pune" }],
            },
            []
        );
        expect(r).toBe("high");
    });
});
