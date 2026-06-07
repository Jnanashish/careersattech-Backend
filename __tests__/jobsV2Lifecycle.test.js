require("./setup");

const express = require("express");
const request = require("supertest");

// Mounting the admin router pulls in the cleanup controller, which requires the
// real verifier scheduler. Mock it so nothing tries to reach the network.
jest.mock("../src/jobs/verifyJobs.scheduler", () => ({
    runVerification: jest.fn(),
}));

const JobV2 = require("../src/modules/jobsV2/jobsV2.model");
const CompanyV2 = require("../src/modules/companiesV2/companiesV2.model");

let app;
beforeAll(() => {
    app = express();
    app.use(express.json({ limit: "1mb" }));
    app.use("/api", require("../src/modules/jobsV2/jobsV2.admin.routes"));
});

const auth = { "x-api-key": "test-secret-key" };
const MISSING_ID = "507f1f77bcf86cd799439011";

let companyId;
beforeEach(async () => {
    const c = await CompanyV2.create({ companyName: "LifeCo", slug: "lifeco" });
    companyId = c._id;
});

async function makeJob(slug, extra = {}) {
    return JobV2.create({
        title: "Test Job",
        slug,
        company: companyId,
        companyName: "LifeCo",
        displayMode: "external_redirect",
        applyLink: `https://example.com/jobs/${slug}`,
        employmentType: ["FULL_TIME"],
        batch: [2024],
        status: "published",
        ...extra,
    });
}

describe("POST /api/admin/jobs/v2/:id/archive", () => {
    test("requires auth", async () => {
        const job = await makeJob("needs-auth");
        const res = await request(app).post(`/api/admin/jobs/v2/${job._id}/archive`);
        expect(res.status).toBe(401);
    });

    test("archives a published job WITHOUT soft-deleting it", async () => {
        const job = await makeJob("archive-me");
        const res = await request(app)
            .post(`/api/admin/jobs/v2/${job._id}/archive`)
            .set(auth);

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe("archived");
        expect(res.body.data.archivedReason).toBe("manual");

        const fresh = await JobV2.findById(job._id).lean();
        expect(fresh.status).toBe("archived");
        expect(fresh.archivedAt).toBeInstanceOf(Date);
        expect(fresh.archivedReason).toBe("manual");
        // critical: archive must NOT set deletedAt (detail URL keeps resolving)
        expect(fresh.deletedAt).toBeNull();
    });

    test("404 on unknown id", async () => {
        const res = await request(app)
            .post(`/api/admin/jobs/v2/${MISSING_ID}/archive`)
            .set(auth);
        expect(res.status).toBe(404);
    });

    test("400 on malformed id", async () => {
        const res = await request(app)
            .post(`/api/admin/jobs/v2/not-an-id/archive`)
            .set(auth);
        expect(res.status).toBe(400);
    });
});

describe("POST /api/admin/jobs/v2/:id/restore", () => {
    test("restores an archived job back to published", async () => {
        const job = await makeJob("restore-me", {
            status: "archived",
            archivedAt: new Date(),
            archivedReason: "manual",
        });
        const res = await request(app)
            .post(`/api/admin/jobs/v2/${job._id}/restore`)
            .set(auth);

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe("published");

        const fresh = await JobV2.findById(job._id).lean();
        expect(fresh.status).toBe("published");
        expect(fresh.archivedAt).toBeNull();
        expect(fresh.archivedReason).toBeNull();
    });

    test("404 when the job isn't archived", async () => {
        const job = await makeJob("already-live");
        const res = await request(app)
            .post(`/api/admin/jobs/v2/${job._id}/restore`)
            .set(auth);
        expect(res.status).toBe(404);
    });
});

describe("DELETE /api/admin/jobs/v2/:id (guarded hard-delete)", () => {
    test("refuses without ?permanent=true and leaves the job intact", async () => {
        const job = await makeJob("keep-me");
        const res = await request(app).delete(`/api/admin/jobs/v2/${job._id}`).set(auth);

        expect(res.status).toBe(400);
        const fresh = await JobV2.findById(job._id).lean();
        expect(fresh).not.toBeNull();
    });

    test("permanently removes the document with ?permanent=true", async () => {
        const job = await makeJob("junk");
        const res = await request(app)
            .delete(`/api/admin/jobs/v2/${job._id}?permanent=true`)
            .set(auth);

        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/permanently deleted/i);
        const fresh = await JobV2.findById(job._id).lean();
        expect(fresh).toBeNull();
    });

    test("404 on permanent delete of unknown id", async () => {
        const res = await request(app)
            .delete(`/api/admin/jobs/v2/${MISSING_ID}?permanent=true`)
            .set(auth);
        expect(res.status).toBe(404);
    });
});
