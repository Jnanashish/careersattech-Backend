const { FULL_PROMPT, JOB_ONLY_PROMPT, SYSTEM_PROMPT } = require("../src/modules/scraper/transformer");

// The "job" field spec runs from the `"job" OBJECT` heading to the next
// ──── separator (company block in the full prompt, salary block in job-only).
// It must be identical in both variants — the routing only adds/removes the
// company section, never the job instructions.
function jobBlock(prompt) {
    const start = prompt.indexOf('"job" OBJECT');
    const end = prompt.indexOf("────", start);
    return prompt.slice(start, end).trim();
}

describe("transformer prompt variants", () => {
    test("job field spec is byte-identical across both prompts", () => {
        const fullJob = jobBlock(FULL_PROMPT);
        const jobOnlyJob = jobBlock(JOB_ONLY_PROMPT);
        expect(fullJob.length).toBeGreaterThan(500);
        expect(jobOnlyJob).toBe(fullJob);
    });

    test("only the full prompt carries the company enrichment block", () => {
        expect(FULL_PROMPT).toContain('"company" OBJECT');
        expect(JOB_ONLY_PROMPT).not.toContain('"company" OBJECT');
    });

    test("job-only prompt tells the model to skip company + references the existing one", () => {
        expect(JOB_ONLY_PROMPT).toContain("already exists in our database");
        expect(JOB_ONLY_PROMPT).toContain("existingCompany.companyName");
        expect(JOB_ONLY_PROMPT).toMatch(/do NOT include a "company" key/i);
    });

    test("full prompt is the default SYSTEM_PROMPT and still asks for both keys", () => {
        expect(SYSTEM_PROMPT).toBe(FULL_PROMPT);
        expect(FULL_PROMPT).toContain("company enrichment");
        expect(FULL_PROMPT).toMatch(/"job": \{\.\.\.\}, "company": \{\.\.\.\}/);
    });

    test("no unrendered section markers leak into either prompt", () => {
        for (const p of [FULL_PROMPT, JOB_ONLY_PROMPT]) {
            expect(p).not.toMatch(/<<\/?(?:NEW|EXISTING)_COMPANY>>/);
        }
    });

    // Both variants share the salary rules verbatim (outside any marker).
    test("salary estimation rules are present and identical in both prompts", () => {
        const salary = (p) => p.slice(p.indexOf("SALARY ESTIMATION"), p.indexOf("RULES:")).trim();
        expect(salary(FULL_PROMPT).length).toBeGreaterThan(100);
        expect(salary(JOB_ONLY_PROMPT)).toBe(salary(FULL_PROMPT));
    });
});

// The pipeline republishes other people's job posts. Every adapter's raw text
// reaches the model through the same prompt, so the "write it yourself" rule
// has to live outside the NEW/EXISTING_COMPANY markers — in a section both
// variants keep — or a job whose company we already have would skip it.
describe("transformer prompt — original-content rules", () => {
    test.each([
        ["FULL_PROMPT", FULL_PROMPT],
        ["JOB_ONLY_PROMPT", JOB_ONLY_PROMPT],
    ])("%s forbids verbatim reuse of the source text", (_name, prompt) => {
        expect(prompt).toMatch(/source of TRUTH, not a source of TEXT/);
        expect(prompt).toMatch(/Copying sentences or bullets verbatim from the source is not acceptable/);
        expect(prompt).toMatch(/must be ORIGINAL PROSE that you wrote/);
        // Rephrasing must not mangle the terms a job seeker searches on.
        expect(prompt).toMatch(/Proper nouns are the exception and must stay exact/);
    });
});
