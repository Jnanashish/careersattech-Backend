require("../../../../__tests__/setup");

const CompanyV2 = require("../../../modules/companiesV2/companiesV2.model");
const { resolveCompany } = require("../resolveCompany");

describe("resolveCompany", () => {
    test("returns existing company by case-insensitive name", async () => {
        const existing = await CompanyV2.create({
            companyName: "Acme Corp",
            slug: "acme-corp",
            status: "active",
        });
        const r = await resolveCompany("acme corp");
        expect(r.wasCreated).toBe(false);
        expect(String(r._id)).toBe(String(existing._id));
        expect(r.slug).toBe("acme-corp");
    });

    test("returns existing company by slug fallback", async () => {
        const existing = await CompanyV2.create({
            companyName: "Different Display Name",
            slug: "acme-corp",
            status: "active",
        });
        const r = await resolveCompany("Acme Corp");
        expect(r.wasCreated).toBe(false);
        expect(String(r._id)).toBe(String(existing._id));
    });

    test("creates stub when not found", async () => {
        const r = await resolveCompany("Brand New Co");
        expect(r.wasCreated).toBe(true);
        expect(r.slug).toBe("brand-new-co");

        const inDb = await CompanyV2.findById(r._id);
        expect(inDb.companyName).toBe("Brand New Co");
        expect(inDb.isVerified).toBe(false);
        expect(inDb.status).toBe("active");
    });

    test("appends nanoid suffix when base slug is taken by a soft-deleted company", async () => {
        await CompanyV2.create({
            companyName: "Old Collide Co",
            slug: "collide-co",
            status: "active",
            deletedAt: new Date(),
        });
        const r = await resolveCompany("Collide Co");
        expect(r.wasCreated).toBe(true);
        expect(r.slug).toMatch(/^collide-co-[a-z0-9]{4}$/);
    });

    test("reuses company when only a legal/group suffix differs", async () => {
        const existing = await CompanyV2.create({
            companyName: "Adani Group",
            slug: "adani-group",
            status: "active",
        });
        const r = await resolveCompany("Adani");
        expect(r.wasCreated).toBe(false);
        expect(String(r._id)).toBe(String(existing._id));
    });

    test("reuses company stripping 'Private Limited'", async () => {
        const existing = await CompanyV2.create({
            companyName: "ABC Private Limited",
            slug: "abc-private-limited",
            status: "active",
        });
        const r = await resolveCompany("ABC");
        expect(r.wasCreated).toBe(false);
        expect(String(r._id)).toBe(String(existing._id));
    });

    test("reuses company on truncated name (prefix match)", async () => {
        const existing = await CompanyV2.create({
            companyName: "Adani",
            slug: "adani",
            status: "active",
        });
        const r = await resolveCompany("Ada");
        expect(r.wasCreated).toBe(false);
        expect(String(r._id)).toBe(String(existing._id));
    });

    test("does NOT merge genuinely different companies sharing a prefix word", async () => {
        await CompanyV2.create({
            companyName: "Tata Technologies",
            slug: "tata-technologies",
            status: "active",
        });
        const r = await resolveCompany("Tata Consultancy Services");
        expect(r.wasCreated).toBe(true);
    });

    test("ignores soft-deleted companies in heuristic match", async () => {
        await CompanyV2.create({
            companyName: "Zeta Group",
            slug: "zeta-group",
            status: "active",
            deletedAt: new Date(),
        });
        const r = await resolveCompany("Zeta");
        expect(r.wasCreated).toBe(true);
    });

    test("throws on empty input", async () => {
        await expect(resolveCompany("")).rejects.toThrow(/companyName is required/);
    });
});
