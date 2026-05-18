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

    test("throws on empty input", async () => {
        await expect(resolveCompany("")).rejects.toThrow(/companyName is required/);
    });
});
