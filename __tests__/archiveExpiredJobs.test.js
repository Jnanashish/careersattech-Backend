require("./setup");

const JobV2 = require("../src/modules/jobsV2/jobsV2.model");
const CompanyV2 = require("../src/modules/companiesV2/companiesV2.model");
const { archiveExpiredJobs } = require("../src/jobs/verifyJobs.scheduler");

const DAY_MS = 24 * 60 * 60 * 1000;

let companyId;
async function makeJob(slug, extra = {}) {
    if (!companyId) {
        const c = await CompanyV2.create({ companyName: "ExpireCo", slug: "expireco" });
        companyId = c._id;
    }
    return JobV2.create({
        title: "Test Job",
        slug,
        company: companyId,
        companyName: "ExpireCo",
        displayMode: "external_redirect",
        applyLink: `https://example.com/jobs/${slug}`,
        employmentType: ["FULL_TIME"],
        batch: [2024],
        status: "published",
        ...extra,
    });
}

afterEach(() => {
    companyId = null;
});

describe("archiveExpiredJobs — validThrough sweep", () => {
    it("archives only published jobs whose validThrough is in the past", async () => {
        const past = new Date(Date.now() - DAY_MS);
        const future = new Date(Date.now() + DAY_MS);

        const expired = await makeJob("expired", { validThrough: past });
        const notYet = await makeJob("not-yet", { validThrough: future });
        const noDate = await makeJob("no-date"); // validThrough absent
        const nullDate = await makeJob("null-date", { validThrough: null });
        const draftExpired = await makeJob("draft-expired", { status: "draft", validThrough: past });
        const deletedExpired = await makeJob("deleted-expired", {
            validThrough: past,
            deletedAt: new Date(),
            status: "published",
        });

        const res = await archiveExpiredJobs();

        expect(res.dryRun).toBe(false);
        expect(res.archived).toBe(1);
        expect(res.matched).toBe(1);

        // The one genuinely expired published job → archived (not deleted).
        const a = await JobV2.findById(expired._id).lean();
        expect(a.status).toBe("archived");
        expect(a.archivedReason).toBe("auto-expired-validThrough");
        expect(a.archivedAt).toBeInstanceOf(Date);
        expect(a.deletedAt).toBeNull();

        // Everything else untouched.
        expect((await JobV2.findById(notYet._id).lean()).status).toBe("published");
        expect((await JobV2.findById(noDate._id).lean()).status).toBe("published");
        expect((await JobV2.findById(nullDate._id).lean()).status).toBe("published");
        expect((await JobV2.findById(draftExpired._id).lean()).status).toBe("draft");
        // Soft-deleted job stays as-is (excluded by deletedAt:null guard).
        expect((await JobV2.findById(deletedExpired._id).lean()).archivedReason).toBeFalsy();
    });

    it("is idempotent — a second run archives nothing", async () => {
        await makeJob("expired", { validThrough: new Date(Date.now() - DAY_MS) });

        const first = await archiveExpiredJobs();
        expect(first.archived).toBe(1);

        const second = await archiveExpiredJobs();
        expect(second.archived).toBe(0);
        expect(second.matched).toBe(0);
    });

    it("dry-run reports the count but writes nothing", async () => {
        const expired = await makeJob("expired", { validThrough: new Date(Date.now() - DAY_MS) });

        const res = await archiveExpiredJobs({ dryRun: true });
        expect(res.dryRun).toBe(true);
        expect(res.archived).toBe(0);
        expect(res.matched).toBe(1);

        // Untouched — still published.
        expect((await JobV2.findById(expired._id).lean()).status).toBe("published");
    });
});
