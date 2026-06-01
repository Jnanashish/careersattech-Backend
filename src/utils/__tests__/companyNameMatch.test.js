const {
    normalizeCompanyName,
    companyNamesMatch,
} = require("../companyNameMatch");

describe("normalizeCompanyName", () => {
    test("strips legal and group suffixes", () => {
        expect(normalizeCompanyName("ABC Private Limited")).toBe("abc");
        expect(normalizeCompanyName("ABC Pvt. Ltd.")).toBe("abc");
        expect(normalizeCompanyName("Adani Group")).toBe("adani");
        expect(normalizeCompanyName("Acme Holdings LLC")).toBe("acme");
    });

    test("lowercases, de-punctuates, strips diacritics and leading 'the'", () => {
        expect(normalizeCompanyName("Nestlé")).toBe("nestle");
        expect(normalizeCompanyName("The Walt Disney Co")).toBe("walt disney");
        expect(normalizeCompanyName("AT&T")).toBe("at and t");
    });

    test("returns empty string for junk", () => {
        expect(normalizeCompanyName("")).toBe("");
        expect(normalizeCompanyName("   ")).toBe("");
        expect(normalizeCompanyName(null)).toBe("");
    });
});

describe("companyNamesMatch", () => {
    test("matches suffix and truncation variants", () => {
        expect(companyNamesMatch("Adani Group", "Adani")).toBe(true);
        expect(companyNamesMatch("Adani", "Ada")).toBe(true);
        expect(companyNamesMatch("ABC Private Limited", "ABC")).toBe(true);
    });

    test("tolerates typos", () => {
        expect(companyNamesMatch("Microsoft", "Micrsoft")).toBe(true);
    });

    test("does not merge distinct companies", () => {
        expect(companyNamesMatch("Tata Technologies", "Tata Consultancy")).toBe(false);
        expect(companyNamesMatch("Adani", "Adobe")).toBe(false);
        expect(companyNamesMatch("Infosys", "Wipro")).toBe(false);
    });

    test("does not merge distinct companies sharing a first word", () => {
        expect(companyNamesMatch("United Health", "United Airlines")).toBe(false);
        expect(companyNamesMatch("United", "United Health")).toBe(false);
        expect(companyNamesMatch("Tata Motors", "Tata Steel")).toBe(false);
        expect(companyNamesMatch("Bank of America", "Bank of Baroda")).toBe(false);
        expect(companyNamesMatch("Adani Ports", "Adani Power")).toBe(false);
    });

    test("two-char fragments are too ambiguous to match", () => {
        expect(companyNamesMatch("Ab", "Abani")).toBe(false);
    });
});
