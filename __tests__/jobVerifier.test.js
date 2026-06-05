require("./setup");

const axios = require("axios");

jest.mock("axios", () => {
    const fn = jest.fn();
    return { __esModule: true, default: fn, get: fn };
});

// Re-require after the mock is in place.
const httpClient = require("../src/services/jobVerifier/httpClient");
const { verifyApplyUrl, _internals } = require("../src/services/jobVerifier/genericVerifier");
const { verifyJob } = require("../src/services/jobVerifier");
const verifyScheduler = require("../src/jobs/verifyJobs.scheduler");
const JobV2 = require("../src/modules/jobsV2/jobsV2.model");
const CompanyV2 = require("../src/modules/companiesV2/companiesV2.model");

// Long, plausible job-page body that won't trip the "empty-body" guard.
const NORMAL_BODY = "<html><body>" + "We are hiring a senior engineer. ".repeat(40) + "</body></html>";

function mockHttp({ status = 200, body = NORMAL_BODY, finalUrl, error } = {}) {
    axios.get.mockImplementationOnce(async (url) => {
        if (error) {
            const e = new Error(error.message || "boom");
            e.code = error.code || "";
            throw e;
        }
        return {
            status,
            data: body,
            request: { res: { responseUrl: finalUrl || url } },
            config: { url },
        };
    });
}

afterEach(() => {
    axios.get.mockReset();
});

describe("verifyApplyUrl — classification", () => {
    test("1. expired on HTTP 404", async () => {
        mockHttp({ status: 404, body: "Not Found" });
        const r = await verifyApplyUrl("https://example.com/jobs/123");
        expect(r.result).toBe("expired");
        expect(r.reason).toBe("status:404");
        expect(r.statusCode).toBe(404);
    });

    test("2. expired on HTTP 410", async () => {
        mockHttp({ status: 410, body: "Gone" });
        const r = await verifyApplyUrl("https://example.com/jobs/123");
        expect(r.result).toBe("expired");
        expect(r.reason).toBe("status:410");
    });

    test("3. expired when body contains 'no job details'", async () => {
        mockHttp({
            status: 200,
            body: "<html><body><h1>Oops, no job details found for this listing.</h1></body></html>",
        });
        const r = await verifyApplyUrl("https://example.com/jobs/123");
        expect(r.result).toBe("expired");
        expect(r.reason).toBe("phrase:no job details");
    });

    test("4. expired with case-insensitive 'This Posting Is Closed'", async () => {
        mockHttp({ status: 200, body: "<p>This Posting Is Closed at this time.</p>" });
        const r = await verifyApplyUrl("https://example.com/jobs/123");
        expect(r.result).toBe("expired");
        expect(r.reason).toBe("phrase:this posting is closed");
    });

    test("5. expired strips HTML around 'position has been filled'", async () => {
        mockHttp({
            status: 200,
            body: "<div><span>position</span> <em>has been</em> <b>filled</b></div>",
        });
        const r = await verifyApplyUrl("https://example.com/jobs/123");
        expect(r.result).toBe("expired");
        expect(r.reason).toBe("phrase:position has been filled");
    });

    test("6. active on normal job description body", async () => {
        mockHttp({ status: 200, body: NORMAL_BODY });
        const r = await verifyApplyUrl("https://example.com/jobs/123");
        expect(r.result).toBe("active");
        expect(r.reason).toBe("no-expired-markers");
    });

    test("7. active (not archived) on timeout (rejected request)", async () => {
        mockHttp({ error: { code: "ECONNABORTED", message: "timeout of 10000ms exceeded" } });
        const r = await verifyApplyUrl("https://example.com/jobs/123");
        expect(r.result).toBe("active");
        expect(r.reason).toBe("timeout");
    });

    test("8. active (not archived) on HTTP 503", async () => {
        mockHttp({ status: 503, body: "<h1>Service Unavailable</h1>" });
        const r = await verifyApplyUrl("https://example.com/jobs/123");
        expect(r.result).toBe("active");
        expect(r.reason).toBe("status:5xx:503");
    });

    test("9. active (not archived) on CAPTCHA marker", async () => {
        mockHttp({ status: 200, body: "<p>Please verify you are human before continuing.</p>" });
        const r = await verifyApplyUrl("https://example.com/jobs/123");
        expect(r.result).toBe("active");
        expect(r.reason).toBe("captcha-or-bot-wall");
    });

    test("10. expired when redirected to /careers", async () => {
        mockHttp({
            status: 200,
            body: NORMAL_BODY,
            finalUrl: "https://example.com/careers",
        });
        const r = await verifyApplyUrl("https://example.com/jobs/abc-123");
        expect(r.result).toBe("expired");
        expect(r.reason).toBe("redirect-to-careers-home");
    });
});

// ─── State machine tests via runVerification ────────────────────────────
describe("runVerification — state machine", () => {
    async function makeJob(slug, overrides = {}) {
        const company = await CompanyV2.create({
            companyName: "VerifyCo",
            slug: "verifyco-" + Math.random().toString(36).slice(2, 8),
        });
        return JobV2.create({
            title: "Test Job",
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

    test("11. lastCheckedAt is set on every result type", async () => {
        const a = await makeJob("active-1");
        const e = await makeJob("expired-1");
        const f = await makeJob("fivexx-1");

        // Mocks fire in the order requests are made; concurrency=5 means parallel
        // dispatch with stable ordering by sort (oldest first). All three docs
        // have lastCheckedAt=null so the order is by insertion. Mock once per job.
        mockHttp({ status: 200, body: NORMAL_BODY }); // active
        mockHttp({ status: 404 }); // expired
        mockHttp({ status: 503 }); // 5xx → active

        await verifyScheduler.runVerification({ trigger: "manual", skipEmail: true });

        for (const id of [a._id, e._id, f._id]) {
            const fresh = await JobV2.findById(id).lean();
            expect(fresh.verification.lastCheckedAt).toBeInstanceOf(Date);
            expect(fresh.verification.lastCheckResult).toBeTruthy();
        }
    });

    test("12. status flips to archived only on expired; unconfirmed (5xx) stays published", async () => {
        const active = await makeJob("active-2");
        const expired = await makeJob("expired-2");
        const fivexx = await makeJob("fivexx-2");

        mockHttp({ status: 200, body: NORMAL_BODY });
        mockHttp({ status: 404 });
        mockHttp({ status: 503 });

        await verifyScheduler.runVerification({ trigger: "manual", skipEmail: true });

        const a = await JobV2.findById(active._id).lean();
        const e = await JobV2.findById(expired._id).lean();
        const f = await JobV2.findById(fivexx._id).lean();

        expect(a.status).toBe("published");
        expect(a.archivedAt).toBeNull();

        expect(e.status).toBe("archived");
        expect(e.archivedAt).toBeInstanceOf(Date);
        expect(e.archivedReason).toBe("auto-verification-expired");

        // 503 is unconfirmed → treated as active, never archived
        expect(f.status).toBe("published");
        expect(f.archivedAt).toBeNull();
        expect(f.verification.lastCheckResult).toBe("active");
    });
});

// Sanity check on internals used by classification.
describe("verifier internals", () => {
    test("stripHtml removes tags and lowercases", () => {
        const out = _internals.stripHtml("<P>Hello <b>WORLD</b></P>");
        expect(out).toBe("hello world");
    });

    test("verifyJob returns shouldArchive=true only when expired", async () => {
        mockHttp({ status: 404 });
        const r = await verifyJob({ applyLink: "https://example.com/x" });
        expect(r.shouldArchive).toBe(true);
        expect(r.archiveReason).toBe("auto-verification-expired");
    });
});
