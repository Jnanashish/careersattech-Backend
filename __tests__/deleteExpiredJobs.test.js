require("./setup");

const JobV2 = require("../src/modules/jobsV2/jobsV2.model");
const JobClickV2 = require("../src/modules/jobsV2/jobClickV2.model");
const CompanyV2 = require("../src/modules/companiesV2/companiesV2.model");
const { deleteExpiredJobs } = require("../src/jobs/verifyJobs.scheduler");

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY_MS);
const daysAhead = (n) => new Date(Date.now() + n * DAY_MS);

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
    delete process.env.EXPIRED_JOBS_GRACE_DAYS;
});

const idsOf = async () => (await JobV2.find({}).select("slug").lean()).map((j) => j.slug).sort();

describe("deleteExpiredJobs — daily validThrough hard delete", () => {
    it("deletes published jobs past validThrough and nothing else", async () => {
        await makeJob("expired", { validThrough: daysAgo(1) });
        await makeJob("not-yet", { validThrough: daysAhead(1) });
        await makeJob("no-date"); // validThrough absent
        await makeJob("null-date", { validThrough: null });
        await makeJob("draft-expired", { status: "draft", validThrough: daysAgo(5) });
        await makeJob("paused-expired", { status: "paused", validThrough: daysAgo(5) });
        // Archived by hand through the admin panel: deletedAt set, different
        // reason. Not this sweep's business even though the date has passed.
        await makeJob("ui-archived", {
            status: "archived",
            validThrough: daysAgo(5),
            deletedAt: new Date(),
            archivedReason: "manual",
        });
        // Soft-deleted while still published.
        await makeJob("soft-deleted", { validThrough: daysAgo(5), deletedAt: new Date() });

        const res = await deleteExpiredJobs();

        expect(res.dryRun).toBe(false);
        expect(res.graceDays).toBe(0);
        expect(res.matched).toBe(1);
        expect(res.deleted).toBe(1);

        expect(await idsOf()).toEqual([
            "draft-expired",
            "no-date",
            "not-yet",
            "null-date",
            "paused-expired",
            "soft-deleted",
            "ui-archived",
        ]);
    });

    it("clears the backlog an earlier archive-only run left behind", async () => {
        // The shape the cron's archive pass writes: status only, no deletedAt.
        await makeJob("auto-archived", {
            status: "archived",
            archivedAt: daysAgo(2),
            archivedReason: "auto-expired-validThrough",
            validThrough: daysAgo(3),
        });
        // Same reason but the date has NOT passed — e.g. validThrough was
        // pushed out after the archive. Still a live posting, so it stays.
        await makeJob("auto-archived-future", {
            status: "archived",
            archivedAt: daysAgo(2),
            archivedReason: "auto-expired-validThrough",
            validThrough: daysAhead(10),
        });
        // Dead-link archive from the verifier — not a date expiry.
        await makeJob("link-archived", {
            status: "archived",
            archivedAt: daysAgo(2),
            archivedReason: "auto-verification-expired",
            validThrough: daysAgo(3),
        });

        const res = await deleteExpiredJobs();

        expect(res.deleted).toBe(1);
        expect(await idsOf()).toEqual(["auto-archived-future", "link-archived"]);
    });

    it("removes the deleted jobs' click events", async () => {
        const expired = await makeJob("expired", { validThrough: daysAgo(1) });
        const kept = await makeJob("kept", { validThrough: daysAhead(1) });

        await JobClickV2.create([
            { job: expired._id, eventType: "apply_click" },
            { job: expired._id, eventType: "detail_view" },
            { job: kept._id, eventType: "apply_click" },
        ]);

        const res = await deleteExpiredJobs();

        expect(res.deleted).toBe(1);
        expect(res.clickEventsDeleted).toBe(2);
        expect(await JobClickV2.countDocuments({})).toBe(1);
        expect(await JobClickV2.countDocuments({ job: kept._id })).toBe(1);
    });

    it("reports what it removed so the Telegram trace survives the delete", async () => {
        await makeJob("expired", { validThrough: new Date("2026-01-15T00:00:00.000Z") });

        const res = await deleteExpiredJobs();

        expect(res.jobs).toHaveLength(1);
        expect(res.jobs[0]).toMatchObject({
            slug: "expired",
            title: "Test Job",
            companyName: "ExpireCo",
            applyLink: "https://example.com/jobs/expired",
            reason: "validThrough 2026-01-15",
        });
    });

    it("dry-run reports the match but deletes nothing", async () => {
        await makeJob("expired", { validThrough: daysAgo(1) });
        const job = await JobV2.findOne({ slug: "expired" }).lean();
        await JobClickV2.create({ job: job._id, eventType: "apply_click" });

        const res = await deleteExpiredJobs({ dryRun: true });

        expect(res.dryRun).toBe(true);
        expect(res.matched).toBe(1);
        expect(res.deleted).toBe(0);
        expect(res.clickEventsDeleted).toBe(0);
        expect(res.jobs).toHaveLength(1);

        expect(await JobV2.countDocuments({})).toBe(1);
        expect(await JobClickV2.countDocuments({})).toBe(1);
    });

    it("is idempotent — a second run finds nothing left", async () => {
        await makeJob("expired", { validThrough: daysAgo(1) });

        expect((await deleteExpiredJobs()).deleted).toBe(1);

        const second = await deleteExpiredJobs();
        expect(second.matched).toBe(0);
        expect(second.deleted).toBe(0);
    });

    describe("grace window", () => {
        it("keeps jobs that expired inside the window", async () => {
            await makeJob("just-expired", { validThrough: daysAgo(3) });
            await makeJob("long-expired", { validThrough: daysAgo(10) });

            const res = await deleteExpiredJobs({ graceDays: 7 });

            expect(res.graceDays).toBe(7);
            expect(res.deleted).toBe(1);
            expect(await idsOf()).toEqual(["just-expired"]);
        });

        it("reads EXPIRED_JOBS_GRACE_DAYS when no override is passed", async () => {
            process.env.EXPIRED_JOBS_GRACE_DAYS = "7";
            await makeJob("just-expired", { validThrough: daysAgo(3) });

            const res = await deleteExpiredJobs();

            expect(res.graceDays).toBe(7);
            expect(res.deleted).toBe(0);
            expect(await JobV2.countDocuments({})).toBe(1);
        });

        it("ignores a junk or negative grace value and deletes immediately", async () => {
            process.env.EXPIRED_JOBS_GRACE_DAYS = "-5";
            await makeJob("expired", { validThrough: daysAgo(1) });

            const res = await deleteExpiredJobs();

            expect(res.graceDays).toBe(0);
            expect(res.deleted).toBe(1);
        });
    });
});
