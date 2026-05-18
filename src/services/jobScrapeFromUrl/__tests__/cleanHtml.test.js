const fs = require("fs");
const path = require("path");
const { cleanHtml } = require("../cleanHtml");

function fixture(name) {
    return fs.readFileSync(path.join(__dirname, "__fixtures__", name), "utf8");
}

describe("cleanHtml", () => {
    test("greenhouse: keeps job content, drops nav/footer/cookie/script", () => {
        const out = cleanHtml(fixture("greenhouse.html"));
        expect(out.text).toContain("Senior Backend Engineer");
        expect(out.text).toContain("Node.js");
        expect(out.text).toContain("Bangalore");
        expect(out.text).not.toContain("Subscribe to our newsletter");
        expect(out.text).not.toContain("We use cookies");
        expect(out.text).not.toContain("console.log");
        expect(out.text).not.toContain("Copyright Acme");
        expect(out.text.length).toBeGreaterThan(0);
        expect(out.text.length).toBeLessThanOrEqual(15000);
    });

    test("lever: extracts posting content", () => {
        const out = cleanHtml(fixture("lever.html"));
        expect(out.text).toContain("Frontend Engineer");
        expect(out.text).toContain("React");
        expect(out.text).not.toContain("FooterLink");
    });

    test("ashby: handles job-detail class match", () => {
        const out = cleanHtml(fixture("ashby.html"));
        expect(out.text).toContain("Data Engineer");
        expect(out.text).toContain("Airflow");
    });

    test("generic-career-page: falls back to body", () => {
        const out = cleanHtml(fixture("generic-career-page.html"));
        expect(out.text).toContain("DevOps Engineer");
        expect(out.text).toContain("Pune");
    });

    test("truncates at 15000 chars", () => {
        const big = "<body><p>" + "x".repeat(20_000) + "</p></body>";
        const out = cleanHtml(big);
        expect(out.text.length).toBeLessThanOrEqual(15000);
        expect(out.html.length).toBeLessThanOrEqual(15000);
    });
});
