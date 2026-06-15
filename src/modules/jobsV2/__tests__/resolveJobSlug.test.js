require("../../../../__tests__/setup");

const mongoose = require("mongoose");
const JobV2 = require("../jobsV2.model");
const { resolveUniqueJobSlug } = require("../resolveJobSlug");

const today = new Date().toISOString().slice(0, 10);

async function seedJob(slug, extra = {}) {
    return JobV2.create({
        title: "Software Engineer",
        slug,
        company: new mongoose.Types.ObjectId(),
        companyName: "Acme",
        displayMode: "external_redirect",
        applyLink: `https://example.com/${slug}`,
        employmentType: ["FULL_TIME"],
        batch: [2025],
        status: "published",
        ...extra,
    });
}

describe("resolveUniqueJobSlug", () => {
    test("returns the clean deterministic base when free", async () => {
        const slug = await resolveUniqueJobSlug("Acme", "Software Engineer");
        expect(slug).toBe("acme-software-engineer");
    });

    test("same company + title always resolves to the same base (repost reuses URL)", async () => {
        const a = await resolveUniqueJobSlug("Acme", "Software Engineer");
        const b = await resolveUniqueJobSlug("Acme", "Software Engineer");
        expect(a).toBe("acme-software-engineer");
        expect(b).toBe("acme-software-engineer");
    });

    test("appends a date suffix on collision", async () => {
        await seedJob("acme-software-engineer");
        const slug = await resolveUniqueJobSlug("Acme", "Software Engineer");
        expect(slug).toBe(`acme-software-engineer-${today}`);
    });

    test("appends a random tie-breaker when both base and dated slug are taken", async () => {
        await seedJob("acme-software-engineer");
        await seedJob(`acme-software-engineer-${today}`);
        const slug = await resolveUniqueJobSlug("Acme", "Software Engineer");
        expect(slug).toMatch(
            new RegExp(`^acme-software-engineer-${today}-[a-z0-9]{6}$`)
        );
    });

    test("treats a soft-deleted slug as taken (matches the unique index scope)", async () => {
        await seedJob("acme-software-engineer", { deletedAt: new Date() });
        const slug = await resolveUniqueJobSlug("Acme", "Software Engineer");
        expect(slug).toBe(`acme-software-engineer-${today}`);
    });
});
