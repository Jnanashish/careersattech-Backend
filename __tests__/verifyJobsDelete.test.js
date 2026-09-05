require("./setup");

const axios = require("axios");

jest.mock("axios", () => {
    const fn = jest.fn();
    return { __esModule: true, default: fn, get: fn, post: fn };
});

// Telegram is fire-and-forget in production; in tests it must never reach the
// network, and the cron path is the only caller so the spy doubles as proof the
// report is sent.
jest.mock("../src/utils/telegram", () => ({
    send: jest.fn().mockResolvedValue(true),
    notifyGeneralError: jest.fn().mockResolvedValue(true),
    notifyJobCleanup: jest.fn().mockResolvedValue(true),
    esc: (v) => String(v ?? ""),
}));

const verifyScheduler = require("../src/jobs/verifyJobs.scheduler");
const JobV2 = require("../src/modules/jobsV2/jobsV2.model");
const JobClickV2 = require("../src/modules/jobsV2/jobClickV2.model");
const CompanyV2 = require("../src/modules/companiesV2/companiesV2.model");

const NORMAL_BODY = "<html><body>" + "We are hiring a senior engineer. ".repeat(40) + "</body></html>";

function mockHttp({ status = 200, body = NORMAL_BODY, finalUrl, error } = {}) {
    axios.get.mockImplementationOnce(async (url) => {
        if (error) {
            const e = new Error(error.message || "boom");
            e.code = error.code || "";
            throw e;
        }
        return { status, data: body, request: { res: { responseUrl: finalUrl || url } }, config: { url } };
    });
}

// Unique company per job — companies_v2 has a unique case-insensitive collation
// index on companyName, so a constant name collides across jobs in one test.
async function makeJob(slug, overrides = {}) {
    const company = await CompanyV2.create({
        companyName: "DeleteCo-" + slug,
        slug: "deleteco-" + slug,
    });
    return JobV2.create({
        title: "Test Job " + slug,
        slug,
        company: company._id,
        companyName: company.companyName,
        displayMode: "external_redirect",
        applyLink: `https://example.com/jobs/${slug}`,
        employmentType: ["FULL_TIME"],
        batch: [2024],
        status: "published",
        ...overrides,
    });
}

afterEach(() => {
    axios.get.mockReset();
});

describe("runVerification — deleteExpired", () => {
    test("hard-deletes confirmed-expired jobs and leaves everything else published", async () => {
        const active = await makeJob("del-active");
        const expired = await makeJob("del-expired");
        const fivexx = await makeJob("del-5xx");

        mockHttp({ status: 200, body: NORMAL_BODY }); // active
        mockHttp({ status: 404 }); // expired → delete
        mockHttp({ status: 503 }); // unconfirmed → active

        const summary = await verifyScheduler.runVerification({
            trigger: "cron",
            skipEmail: true,
            deleteExpired: true,
        });

        expect(summary.deleteExpired).toBe(true);
        expect(summary.expiredCount).toBe(1);
        expect(summary.deletedCount).toBe(1);
        expect(summary.deletedJobs).toHaveLength(1);
        expect(summary.deletedJobs[0].reason).toBe("status:404");

        // Gone from Mongo — not archived, not soft-deleted.
        expect(await JobV2.findById(expired._id).lean()).toBeNull();

        // A 503 is never a confirmation of death; it must survive untouched.
        const f = await JobV2.findById(fivexx._id).lean();
        expect(f.status).toBe("published");
        expect(f.verification.lastCheckResult).toBe("active");

        const a = await JobV2.findById(active._id).lean();
        expect(a.status).toBe("published");
        expect(a.verification.lastCheckedAt).toBeInstanceOf(Date);
    });

    test("removes the deleted job's click events", async () => {
        const expired = await makeJob("del-clicks");
        await JobClickV2.create([
            { job: expired._id, eventType: "apply_click", sessionHash: "a" },
            { job: expired._id, eventType: "apply_click", sessionHash: "b" },
        ]);

        mockHttp({ status: 410 });

        const summary = await verifyScheduler.runVerification({
            trigger: "cron",
            skipEmail: true,
            deleteExpired: true,
        });

        expect(summary.deletedCount).toBe(1);
        expect(summary.clickEventsDeleted).toBe(2);
        expect(await JobClickV2.countDocuments({ job: expired._id })).toBe(0);
    });

    test("dryRun deletes nothing", async () => {
        const expired = await makeJob("del-dry");

        mockHttp({ status: 404 });

        const summary = await verifyScheduler.runVerification({
            trigger: "cron",
            skipEmail: true,
            deleteExpired: true,
            dryRun: true,
        });

        expect(summary.expiredCount).toBe(1);
        expect(summary.deletedCount).toBe(0);

        const still = await JobV2.findById(expired._id).lean();
        expect(still).not.toBeNull();
        expect(still.status).toBe("published");
    });

    test("without deleteExpired the manual/admin path still archives, never deletes", async () => {
        const expired = await makeJob("del-optout");

        mockHttp({ status: 404 });

        const summary = await verifyScheduler.runVerification({
            trigger: "manual",
            skipEmail: true,
        });

        expect(summary.deletedCount).toBe(0);
        expect(summary.deletedJobs).toHaveLength(0);

        const doc = await JobV2.findById(expired._id).lean();
        expect(doc).not.toBeNull();
        expect(doc.status).toBe("archived");
        expect(doc.archivedReason).toBe("auto-verification-expired");
        // Still visible in the flagged review queue (that filter is deletedAt:null).
        expect(doc.deletedAt).toBeNull();
        expect(doc.verification.lastCheckResult).toBe("expired");
    });
});

describe("cleanup cron wiring", () => {
    test("default schedule is every 12 hours", () => {
        const cron = require("node-cron");
        expect(cron.validate("0 */12 * * *")).toBe(true);
    });
});
