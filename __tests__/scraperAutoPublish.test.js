require("./setup");

// Scraped jobs skip the staging review queue and go live immediately.
// The queue itself still exists: every job is written to StagingJob first
// (that's where the dedupe fingerprints live), and anything that isn't
// publish-ready stays `pending` there for manual approval.

jest.mock("../src/modules/scraper/scraper.fetch", () => ({
    scrapeAll: jest.fn(),
    scrapeOne: jest.fn(),
    getAdapterByName: jest.fn(),
    listAllAdapters: jest.fn(() => []),
}));

jest.mock("../src/modules/scraper/transformer", () => ({
    transformBatch: jest.fn(),
}));

jest.mock("../src/modules/scraper/providers", () => ({
    getProvider: () => ({ name: "test-provider" }),
}));

jest.mock("../src/modules/scraper/notifier", () => ({
    sendScrapeReport: jest.fn(),
    sendAdapterAlert: jest.fn(),
    sendRepeatedFailureAlert: jest.fn(),
    sendCriticalAlert: jest.fn(),
}));

const { scrapeAll } = require("../src/modules/scraper/scraper.fetch");
const { transformBatch } = require("../src/modules/scraper/transformer");
const { runPipeline } = require("../src/jobs/scraper.scheduler");
const {
    publishPendingBacklog,
    MAX_AUTO_PUBLISH_ATTEMPTS,
} = require("../src/modules/scraper/publisher");
const StagingJob = require("../src/modules/scraper/models/stagingJob.model");
const JobV2 = require("../src/modules/jobsV2/jobsV2.model");
const CompanyV2 = require("../src/modules/companiesV2/companiesV2.model");

const SOURCE_URL = "https://example.test/jobs/frontend-engineer";
const COMPANY_URL = "https://acme.test/careers";

function scrapeResult() {
    return [
        {
            adapter: "testadapter",
            jobs: [{ sourceUrl: SOURCE_URL, companyPageUrl: COMPANY_URL, pageContent: "raw", meta: {} }],
            stats: { jobLinksFound: 1, jobsFetched: 1, errors: [], durationMs: 5, status: "success" },
        },
    ];
}

function transformResult(jobDataOverrides = {}) {
    return {
        results: [
            {
                sourceUrl: SOURCE_URL,
                companyPageUrl: COMPANY_URL,
                jobData: {
                    title: "Frontend Engineer",
                    applyLink: "https://acme.test/apply/1",
                    // external_redirect keeps jobDescription.html out of the
                    // publish-readiness gate
                    displayMode: "external_redirect",
                    employmentType: ["FULL_TIME"],
                    batch: [2025],
                    companyName: "Acme Test Labs",
                    ...jobDataOverrides,
                },
                companyData: { companyName: "Acme Test Labs", website: "https://acme.test" },
            },
        ],
        errors: [],
    };
}

describe("scraper auto-publish bypass", () => {
    const originalFlag = process.env.SCRAPER_AUTO_PUBLISH;

    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.SCRAPER_AUTO_PUBLISH;
        scrapeAll.mockResolvedValue(scrapeResult());
        transformBatch.mockResolvedValue(transformResult());
    });

    afterAll(() => {
        if (originalFlag === undefined) delete process.env.SCRAPER_AUTO_PUBLISH;
        else process.env.SCRAPER_AUTO_PUBLISH = originalFlag;
    });

    it("publishes a scraped job with no manual approval by default", async () => {
        const log = await runPipeline("cron");

        const job = await JobV2.findOne({});
        expect(job).not.toBeNull();
        expect(job.status).toBe("published");
        expect(job.source).toBe("scraped");
        expect(job.publishedAt).toBeInstanceOf(Date);
        expect(job.slug).toBeTruthy();

        // company auto-created and linked
        const company = await CompanyV2.findById(job.company);
        expect(company.companyName).toBe("Acme Test Labs");

        // staging row kept, marked approved — the queue is bypassed, not removed
        const staged = await StagingJob.findOne({});
        expect(staged.status).toBe("approved");
        expect(String(staged.approvedJob)).toBe(String(job._id));

        expect(log.summary.totalPublished).toBe(1);
    });

    it("falls back to the review queue when SCRAPER_AUTO_PUBLISH=false", async () => {
        process.env.SCRAPER_AUTO_PUBLISH = "false";

        const log = await runPipeline("cron");

        expect(await JobV2.countDocuments({})).toBe(0);
        const staged = await StagingJob.findOne({});
        expect(staged.status).toBe("pending");
        expect(log.summary.totalPublished).toBe(0);
    });

    it("honours a per-run autoPublish: false override", async () => {
        const log = await runPipeline("manual", undefined, { autoPublish: false });

        expect(await JobV2.countDocuments({})).toBe(0);
        expect((await StagingJob.findOne({})).status).toBe("pending");
        expect(log.summary.totalPublished).toBe(0);
    });

    it("leaves jobs that fail the publish-readiness gate pending in staging", async () => {
        // no batch → validatePublishReadiness rejects
        transformBatch.mockResolvedValue(transformResult({ batch: [] }));

        const log = await runPipeline("cron");

        expect(await JobV2.countDocuments({})).toBe(0);
        const staged = await StagingJob.findOne({});
        expect(staged.status).toBe("pending");
        expect(staged.autoPublishAttempts).toBe(1);
        expect(staged.lastAutoPublishError).toMatch(/batch/);
        expect(log.summary.totalNew).toBe(1);
        expect(log.summary.totalPublished).toBe(0);
    });
});

// Rows staged by an earlier run are invisible to the per-adapter auto-publish
// (it only sees what the current run created) and dedupe stops a re-scrape from
// re-staging them, so the pipeline sweeps the pending queue itself.
describe("pending backlog drain", () => {
    const originalFlag = process.env.SCRAPER_AUTO_PUBLISH;

    function pendingRow(overrides = {}, jobDataOverrides = {}) {
        return {
            status: "pending",
            source: "legacyadapter",
            sourceUrl: "https://example.test/jobs/old-backend-engineer",
            fingerprint: "acme-test-labs_backend-engineer_",
            jobData: {
                title: "Backend Engineer",
                applyLink: "https://acme.test/apply/legacy",
                displayMode: "external_redirect",
                employmentType: ["FULL_TIME"],
                batch: [2025],
                companyName: "Acme Test Labs",
                ...jobDataOverrides,
            },
            companyData: { companyName: "Acme Test Labs" },
            ...overrides,
        };
    }

    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.SCRAPER_AUTO_PUBLISH;
        // no fresh jobs this run — only the pre-existing backlog matters
        scrapeAll.mockResolvedValue([
            {
                adapter: "testadapter",
                jobs: [],
                stats: { jobLinksFound: 0, jobsFetched: 0, errors: [], durationMs: 1, status: "success" },
            },
        ]);
        transformBatch.mockResolvedValue({ results: [], errors: [] });
    });

    afterAll(() => {
        if (originalFlag === undefined) delete process.env.SCRAPER_AUTO_PUBLISH;
        else process.env.SCRAPER_AUTO_PUBLISH = originalFlag;
    });

    it("publishes rows left pending by an earlier run", async () => {
        const staged = await StagingJob.create(pendingRow());

        const log = await runPipeline("cron");

        const job = await JobV2.findOne({});
        expect(job).not.toBeNull();
        expect(job.status).toBe("published");
        expect(job.title).toBe("Backend Engineer");

        const after = await StagingJob.findById(staged._id);
        expect(after.status).toBe("approved");
        expect(String(after.approvedJob)).toBe(String(job._id));

        expect(log.summary.totalPublished).toBe(1);
        expect(log.summary.totalBacklogPublished).toBe(1);
    });

    it("sweeps rows staged before autoPublishAttempts existed", async () => {
        // Pre-existing rows have no counter at all. A bare `$lt` filter would
        // skip exactly these — the backlog the drain was written for.
        const staged = await StagingJob.create(pendingRow());
        await StagingJob.collection.updateOne(
            { _id: staged._id },
            { $unset: { autoPublishAttempts: "" } }
        );

        const result = await publishPendingBacklog();

        expect(result).toEqual({ scanned: 1, published: 1, failed: 0 });
    });

    it("does not drain when auto-publish is off", async () => {
        process.env.SCRAPER_AUTO_PUBLISH = "false";
        await StagingJob.create(pendingRow());

        const log = await runPipeline("cron");

        expect(await JobV2.countDocuments({})).toBe(0);
        expect((await StagingJob.findOne({})).status).toBe("pending");
        expect(log.summary.totalBacklogPublished).toBe(0);
    });

    it("stops retrying a row after MAX_AUTO_PUBLISH_ATTEMPTS", async () => {
        // missing batch → fails the gate on every attempt
        const staged = await StagingJob.create(pendingRow({}, { batch: [] }));

        for (let i = 0; i < MAX_AUTO_PUBLISH_ATTEMPTS; i++) {
            const result = await publishPendingBacklog();
            expect(result.published).toBe(0);
            expect(result.scanned).toBe(1);
        }

        const exhausted = await StagingJob.findById(staged._id);
        expect(exhausted.autoPublishAttempts).toBe(MAX_AUTO_PUBLISH_ATTEMPTS);

        // now skipped entirely — it waits for a human instead of burning a
        // retry on every run
        expect(await publishPendingBacklog()).toEqual({ scanned: 0, published: 0, failed: 0 });
        // ...unless the caller explicitly asks for exhausted rows
        expect((await publishPendingBacklog({ retryExhausted: true })).scanned).toBe(1);
    });

    it("honours the source filter and limit", async () => {
        await StagingJob.create(pendingRow());
        await StagingJob.create(
            pendingRow(
                { source: "otheradapter", fingerprint: "acme-test-labs_data-analyst_" },
                { title: "Data Analyst", applyLink: "https://acme.test/apply/other" }
            )
        );

        const bySource = await publishPendingBacklog({ source: "otheradapter" });
        expect(bySource.scanned).toBe(1);
        expect(bySource.published).toBe(1);
        expect((await JobV2.findOne({})).title).toBe("Data Analyst");

        const limited = await publishPendingBacklog({ limit: 1 });
        expect(limited.scanned).toBe(1);
    });
});
