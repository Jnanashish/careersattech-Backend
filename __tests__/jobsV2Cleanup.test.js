require("./setup");

const express = require("express");
const request = require("supertest");

// The cleanup controller kicks off the real verifier in the background. Mock it
// so verify-now tests stay offline and deterministic.
jest.mock("../src/jobs/verifyJobs.scheduler", () => ({
    runVerification: jest.fn(),
}));

const { runVerification } = require("../src/jobs/verifyJobs.scheduler");
const JobV2 = require("../src/modules/jobsV2/jobsV2.model");
const CompanyV2 = require("../src/modules/companiesV2/companiesV2.model");
const verifyState = require("../src/modules/jobsV2/jobsV2.verifyState");

let app;
beforeAll(() => {
    app = express();
    app.use(express.json({ limit: "1mb" }));
    app.use("/api", require("../src/modules/jobsV2/jobsV2.admin.routes"));
});

beforeEach(() => {
    verifyState._reset();
    runVerification.mockReset();
});

const auth = { "x-api-key": "test-secret-key" };

let companyId;
async function makeJob(slug, verification, extra = {}) {
    if (!companyId) {
        const c = await CompanyV2.create({ companyName: "FlagCo", slug: "flagco" });
        companyId = c._id;
    }
    return JobV2.create({
        title: "Test Job",
        slug,
        company: companyId,
        companyName: "FlagCo",
        displayMode: "external_redirect",
        applyLink: `https://example.com/jobs/${slug}`,
        employmentType: ["FULL_TIME"],
        batch: [2024],
        status: extra.status || "published",
        verification,
        ...extra,
    });
}
afterEach(() => {
    companyId = null;
});

// Seed one of each relevant state.
async function seedAll() {
    const active = await makeJob("active", {
        lastCheckResult: "active",
        lastCheckedAt: new Date(),
    });
    const expired = await makeJob(
        "expired",
        { lastCheckResult: "expired", lastCheckedAt: new Date() },
        { status: "archived", archivedReason: "auto-verification-expired", archivedAt: new Date() }
    );
    const inconclusive = await makeJob("inconclusive", {
        lastCheckResult: "inconclusive",
        lastCheckedAt: new Date(),
    });
    const neverChecked = await makeJob("never", undefined); // lastCheckResult null
    const alreadyDeleted = await makeJob(
        "deleted",
        { lastCheckResult: "expired", lastCheckedAt: new Date() },
        { deletedAt: new Date(), status: "archived" }
    );
    return { active, expired, inconclusive, neverChecked, alreadyDeleted };
}

describe("GET /api/admin/jobs/v2/flagged", () => {
    test("requires auth", async () => {
        const res = await request(app).get("/api/admin/jobs/v2/flagged");
        expect(res.status).toBe(401);
    });

    test("returns only expired + inconclusive, excludes active/unchecked/deleted", async () => {
        const { expired, inconclusive } = await seedAll();
        const res = await request(app).get("/api/admin/jobs/v2/flagged").set(auth);
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(2);
        const slugs = res.body.jobs.map((j) => j.slug).sort();
        expect(slugs).toEqual(["expired", "inconclusive"]);
        // sanity: ids are the ones we expect
        const ids = res.body.jobs.map((j) => String(j._id)).sort();
        expect(ids).toEqual([String(expired._id), String(inconclusive._id)].sort());
    });

    test("?result=expired narrows the queue", async () => {
        await seedAll();
        const res = await request(app)
            .get("/api/admin/jobs/v2/flagged?result=expired")
            .set(auth);
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(1);
        expect(res.body.jobs[0].slug).toBe("expired");
    });

    test("rejects an invalid result filter", async () => {
        const res = await request(app)
            .get("/api/admin/jobs/v2/flagged?result=banana")
            .set(auth);
        expect(res.status).toBe(400);
    });
});

describe("POST /api/admin/jobs/v2/flagged/purge", () => {
    test("all:true soft-deletes every flagged job, leaves the rest", async () => {
        const { active, expired, inconclusive, neverChecked } = await seedAll();
        const res = await request(app)
            .post("/api/admin/jobs/v2/flagged/purge")
            .set(auth)
            .send({ all: true });
        expect(res.status).toBe(200);
        expect(res.body.deleted).toBe(2);

        for (const id of [expired._id, inconclusive._id]) {
            const fresh = await JobV2.findById(id).lean();
            expect(fresh.deletedAt).toBeInstanceOf(Date);
            expect(fresh.status).toBe("archived");
        }
        // untouched
        expect((await JobV2.findById(active._id).lean()).deletedAt).toBeNull();
        expect((await JobV2.findById(neverChecked._id).lean()).deletedAt).toBeNull();

        // queue now empty
        const after = await request(app).get("/api/admin/jobs/v2/flagged").set(auth);
        expect(after.body.total).toBe(0);
    });

    test("ids:[..] soft-deletes only the given jobs", async () => {
        const { expired, inconclusive } = await seedAll();
        const res = await request(app)
            .post("/api/admin/jobs/v2/flagged/purge")
            .set(auth)
            .send({ ids: [String(expired._id)] });
        expect(res.status).toBe(200);
        expect(res.body.deleted).toBe(1);
        expect((await JobV2.findById(expired._id).lean()).deletedAt).toBeInstanceOf(Date);
        expect((await JobV2.findById(inconclusive._id).lean()).deletedAt).toBeNull();
    });

    test("empty body is rejected (no accidental bulk wipe)", async () => {
        await seedAll();
        const res = await request(app)
            .post("/api/admin/jobs/v2/flagged/purge")
            .set(auth)
            .send({});
        expect(res.status).toBe(400);
    });

    test("invalid id in list is rejected by the validator", async () => {
        const res = await request(app)
            .post("/api/admin/jobs/v2/flagged/purge")
            .set(auth)
            .send({ ids: ["not-an-objectid"] });
        expect(res.status).toBe(400);
    });
});

describe("POST /api/admin/jobs/v2/verify-now", () => {
    test("returns 202, runs in background, rejects a concurrent run, then reports the summary", async () => {
        let resolveRun;
        runVerification.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveRun = () =>
                        resolve({
                            totalChecked: 3,
                            activeCount: 1,
                            expiredCount: 1,
                            inconclusiveCount: 1,
                            archivedJobs: [],
                            inconclusiveJobs: [],
                        });
                })
        );

        const res1 = await request(app).post("/api/admin/jobs/v2/verify-now").set(auth).send({});
        expect(res1.status).toBe(202);
        expect(res1.body.status).toBe("running");
        expect(verifyState.isRunning()).toBe(true);

        // background call uses the manual, email-suppressed path
        expect(runVerification).toHaveBeenCalledWith(
            expect.objectContaining({ trigger: "manual", skipEmail: true })
        );

        // second trigger while in flight → 409
        const res2 = await request(app).post("/api/admin/jobs/v2/verify-now").set(auth).send({});
        expect(res2.status).toBe(409);

        // let the background run finish
        resolveRun();
        await verifyState.getCurrent();

        const status = await request(app)
            .get("/api/admin/jobs/v2/verify-now/status")
            .set(auth);
        expect(status.status).toBe(200);
        expect(status.body.running).toBe(false);
        expect(status.body.lastRun.totalChecked).toBe(3);
    });

    test("requires auth", async () => {
        const res = await request(app).post("/api/admin/jobs/v2/verify-now").send({});
        expect(res.status).toBe(401);
        expect(runVerification).not.toHaveBeenCalled();
    });

    test("a background run failure clears the running flag", async () => {
        runVerification.mockImplementation(() => Promise.reject(new Error("boom")));
        const res = await request(app).post("/api/admin/jobs/v2/verify-now").set(auth).send({});
        expect(res.status).toBe(202);
        await verifyState.getCurrent();
        expect(verifyState.isRunning()).toBe(false);
    });
});
