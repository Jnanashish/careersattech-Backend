require("./setup");

// config loads .env, which may carry the real bot token, so the transport is
// mocked twice over: `send`/`sendDocuments` themselves, and axios underneath
// them in case a code path ever reaches the real one. No test in this file may
// post to Telegram.
jest.mock("axios", () => ({
    post: jest.fn().mockRejectedValue(new Error("network disabled in tests")),
    get: jest.fn().mockRejectedValue(new Error("network disabled in tests")),
}));
jest.mock("../src/utils/telegram", () => ({
    ...jest.requireActual("../src/utils/telegram"),
    send: jest.fn(),
    sendDocuments: jest.fn(),
    notifyGeneralError: jest.fn(),
}));
// Real banner renders are covered in socialDigestBanner.test.js.
jest.mock("../src/services/socialDigest/banner", () => ({
    renderBanners: jest.fn(),
}));
jest.mock("node-cron", () => ({
    ...jest.requireActual("node-cron"),
    schedule: jest.fn(),
}));

const express = require("express");
const request = require("supertest");
const cron = require("node-cron");

const JobV2 = require("../src/modules/jobsV2/jobsV2.model");
const CompanyV2 = require("../src/modules/companiesV2/companiesV2.model");
const { send, sendDocuments, notifyGeneralError, MAX_MESSAGE_LEN } = require("../src/utils/telegram");
const { renderBanners } = require("../src/services/socialDigest/banner");
const {
    runSocialDigest,
    selectDigestJobs,
    buildDigestMessages,
    SITE_URL,
} = require("../src/services/socialDigest");
const { isBestToPost, isFresherExperience } = require("../src/services/socialDigest/bestToPost");
const { stylize } = require("../src/services/socialDigest/captions/whatsapp");
const scheduler = require("../src/jobs/socialDigest.scheduler");

const HOUR_MS = 60 * 60 * 1000;
// 16:00 IST — when the cron fires.
const NOW = new Date("2026-10-04T10:30:00.000Z");
const hoursBefore = (base, h) => new Date(base.getTime() - h * HOUR_MS);
const hoursAgo = (h) => hoursBefore(NOW, h);

const LOGO = { icon: "https://cdn.test/logo.png" };

function makeCompany(companyName, extra = {}) {
    return CompanyV2.create({
        companyName,
        slug: companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        logo: LOGO,
        companyType: "bigtech",
        ...extra,
    });
}

function makeJob(slug, company, extra = {}) {
    return JobV2.create({
        title: "Software Engineer",
        slug,
        company: company._id,
        companyName: company.companyName,
        displayMode: "external_redirect",
        applyLink: `https://example.com/jobs/${slug}`,
        employmentType: ["FULL_TIME"],
        batch: [2025, 2026],
        degree: ["B.Tech"],
        experience: { min: 0, max: 2 },
        status: "published",
        datePosted: hoursAgo(1),
        ...extra,
    });
}

const slugsOf = (jobs) => jobs.map((j) => j.slug);

const sentSlugs = async () =>
    (await JobV2.find({ socialDigestSentAt: { $ne: null } }).select("slug").lean())
        .map((j) => j.slug)
        .sort();

// Seven eligible jobs across every ranked company type — one more than a digest holds.
async function seedSevenEligible(base = NOW) {
    const google = await makeCompany("Google");
    const microsoft = await makeCompany("Microsoft");
    const swiggy = await makeCompany("Swiggy", { companyType: "unicorn" });
    const postman = await makeCompany("Postman", { companyType: "product" });
    const accenture = await makeCompany("Accenture", { companyType: "mnc" });

    await makeJob("google-new", google, { datePosted: hoursBefore(base, 2) });
    await makeJob("google-old", google, { datePosted: hoursBefore(base, 10) });
    await makeJob("microsoft-mid", microsoft, { datePosted: hoursBefore(base, 5) });
    await makeJob("swiggy", swiggy, { datePosted: hoursBefore(base, 1) });
    await makeJob("postman", postman, { datePosted: hoursBefore(base, 1) });
    await makeJob("accenture-new", accenture, { datePosted: hoursBefore(base, 0.5) });
    await makeJob("accenture-old", accenture, { datePosted: hoursBefore(base, 3) });
}

// The order seedSevenEligible's jobs rank in; the last one misses the cut.
const RANKED_SIX = ["google-new", "microsoft-mid", "google-old", "swiggy", "postman", "accenture-new"];

const bannerFile = (job) => ({
    filename: `${job.slug}.jpg`,
    buffer: Buffer.from(`banner ${job.slug}`),
    contentType: "image/jpeg",
});

// Every post in the order it was made: ["text", body] or ["files", filenames].
let posted;

beforeEach(() => {
    posted = [];
    send.mockReset();
    send.mockImplementation(async (text) => {
        posted.push(["text", text]);
        return true;
    });
    sendDocuments.mockReset();
    sendDocuments.mockImplementation(async (files) => {
        posted.push(["files", files.map((f) => f.filename)]);
        return true;
    });
    renderBanners.mockReset();
    renderBanners.mockImplementation(async (jobs) => jobs.map((job) => ({ job, file: bannerFile(job) })));
    notifyGeneralError.mockReset();
    cron.schedule.mockReset();
});

afterEach(() => {
    delete process.env.SOCIAL_DIGEST_ENABLED;
    delete process.env.SOCIAL_DIGEST_CRON;
    delete process.env.SOCIAL_DIGEST_LOOKBACK_HOURS;
});

describe("bestToPost — parity with the admin panel's three checks", () => {
    it("accepts only an experience range inside 0–4 years", () => {
        expect(isFresherExperience({ min: 0, max: 2 })).toBe(true);
        expect(isFresherExperience({ min: 0, max: 4 })).toBe(true);
        expect(isFresherExperience({ min: null, max: 3 })).toBe(true);
        expect(isFresherExperience({ min: 0, max: 5 })).toBe(false);
        expect(isFresherExperience({ min: 5, max: null })).toBe(false);
        expect(isFresherExperience({ min: -1, max: 2 })).toBe(false);
        expect(isFresherExperience({ min: null, max: null })).toBe(false);
        expect(isFresherExperience(undefined)).toBe(false);
    });

    it("needs a populated company with a logo and a known company type", () => {
        const experience = { min: 0, max: 2 };
        expect(isBestToPost({ experience, company: { logo: LOGO, companyType: "unicorn" } })).toBe(true);
        expect(isBestToPost({ experience, company: { logo: { banner: "x" }, companyType: "mnc" } })).toBe(true);
        expect(isBestToPost({ experience, company: { logo: {}, companyType: "bigtech" } })).toBe(false);
        expect(isBestToPost({ experience, company: { logo: LOGO, companyType: "service" } })).toBe(false);
        // An unpopulated ref cannot be checked, so it does not qualify.
        expect(isBestToPost({ experience, company: "65f000000000000000000000" })).toBe(false);
    });
});

describe("selectDigestJobs", () => {
    it("ranks bigtech > unicorn > product > mnc, newest first within a type, and caps at six", async () => {
        await seedSevenEligible();
        expect(slugsOf(await selectDigestJobs({ now: NOW }))).toEqual(RANKED_SIX);
    });

    it("caps the pick at `count` when one is given", async () => {
        await seedSevenEligible();
        expect(slugsOf(await selectDigestJobs({ now: NOW, count: 5 }))).toEqual(RANKED_SIX.slice(0, 5));
    });

    it("skips jobs that fail best-to-post or are not live, fresh and unsent", async () => {
        const google = await makeCompany("Google");
        const noLogo = await makeCompany("NoLogo", { logo: {} });
        const service = await makeCompany("ServiceCo", { companyType: "service" });

        await makeJob("keep", google, { datePosted: hoursAgo(1) });
        await makeJob("keep-valid-until-later", google, {
            datePosted: hoursAgo(2),
            validThrough: new Date(NOW.getTime() + 24 * HOUR_MS),
        });

        await makeJob("no-logo", noLogo);
        await makeJob("service-company", service);
        await makeJob("senior", google, { experience: { min: 3, max: 6 } });
        await makeJob("no-experience", google, { experience: { min: null, max: null } });
        await makeJob("draft", google, { status: "draft" });
        await makeJob("soft-deleted", google, { deletedAt: hoursAgo(1) });
        await makeJob("already-sent", google, { socialDigestSentAt: hoursAgo(24) });
        await makeJob("stale", google, { datePosted: hoursAgo(30) });
        await makeJob("expired", google, { validThrough: hoursAgo(1) });

        expect(slugsOf(await selectDigestJobs({ now: NOW }))).toEqual([
            "keep",
            "keep-valid-until-later",
        ]);
    });

    it("widens the window with SOCIAL_DIGEST_LOOKBACK_HOURS", async () => {
        const google = await makeCompany("Google");
        await makeJob("thirty-hours-old", google, { datePosted: hoursAgo(30) });

        expect(await selectDigestJobs({ now: NOW })).toHaveLength(0);

        process.env.SOCIAL_DIGEST_LOOKBACK_HOURS = "48";
        expect(slugsOf(await selectDigestJobs({ now: NOW }))).toEqual(["thirty-hours-old"]);
    });
});

describe("runSocialDigest", () => {
    it("posts the list, the banners as files, then both captions, and stamps exactly the jobs it sent", async () => {
        await seedSevenEligible();

        const res = await runSocialDigest({ trigger: "cron", now: NOW });

        expect(res.sent).toBe(true);
        expect(res.reason).toBeNull();
        expect(slugsOf(res.jobs)).toEqual(RANKED_SIX);
        expect(res.banners).toEqual({ sent: 6, failed: 0 });

        const [list, caption, whatsapp] = res.messages;
        expect(posted).toEqual([
            ["text", list],
            ["files", RANKED_SIX.map((slug) => `${slug}.jpg`)],
            ["text", caption],
            ["text", whatsapp],
        ]);
        expect(send.mock.calls.every(([, channel]) => channel === "socialDigest")).toBe(true);
        expect(sendDocuments.mock.calls[0][1]).toBe("socialDigest");
        expect(slugsOf(renderBanners.mock.calls[0][0])).toEqual(RANKED_SIX);

        expect(await sentSlugs()).toEqual([...RANKED_SIX].sort());
        const stamped = await JobV2.findOne({ slug: "google-new" }).lean();
        expect(stamped.socialDigestSentAt.toISOString()).toBe(NOW.toISOString());
        expect(notifyGeneralError).not.toHaveBeenCalled();
    });

    it("still sends the digest when a banner fails, flags that job and alerts", async () => {
        await seedSevenEligible();
        const boom = new Error("satori could not lay out the title");
        renderBanners.mockImplementation(async (jobs) =>
            jobs.map((job) =>
                job.slug === "swiggy" ? { job, file: null, error: boom } : { job, file: bannerFile(job) }
            )
        );

        const res = await runSocialDigest({ trigger: "cron", now: NOW });

        expect(res.sent).toBe(true);
        expect(res.banners).toEqual({ sent: 5, failed: 1 });
        expect(sendDocuments.mock.calls[0][0].map((f) => f.filename)).not.toContain("swiggy.jpg");

        const list = res.messages[0];
        const swiggyEntry = list.split("\n\n").find((entry) => entry.includes("<b>Swiggy</b>"));
        expect(swiggyEntry).toContain("Banner failed");
        expect(list.match(/Banner failed/g)).toHaveLength(1);

        expect(await sentSlugs()).toEqual([...RANKED_SIX].sort());
        expect(notifyGeneralError).toHaveBeenCalledTimes(1);
        expect(notifyGeneralError.mock.calls[0][1]).toBe(boom);
    });

    it("sends the text alone when every banner fails", async () => {
        await seedSevenEligible();
        renderBanners.mockImplementation(async (jobs) =>
            jobs.map((job) => ({ job, file: null, error: new Error("no fonts") }))
        );

        const res = await runSocialDigest({ trigger: "cron", now: NOW });

        expect(res.sent).toBe(true);
        expect(sendDocuments).not.toHaveBeenCalled();
        expect(posted.map(([kind]) => kind)).toEqual(["text", "text", "text"]);
        expect(await sentSlugs()).toEqual([...RANKED_SIX].sort());
    });

    it("never sends the same job twice", async () => {
        await seedSevenEligible();
        await runSocialDigest({ trigger: "cron", now: NOW });

        const second = await runSocialDigest({ trigger: "cron", now: NOW });

        expect(slugsOf(second.jobs)).toEqual(["accenture-old"]);
    });

    it("stamps nothing and posts no captions when Telegram refuses the banners", async () => {
        await seedSevenEligible();
        sendDocuments.mockResolvedValue(false);

        const res = await runSocialDigest({ trigger: "cron", now: NOW });

        expect(res.sent).toBe(false);
        expect(res.reason).toBe("telegram-failed");
        expect(send).toHaveBeenCalledTimes(1); // the list only
        expect(await sentSlugs()).toEqual([]);
    });

    it("stamps nothing when Telegram refuses a caption after the banners went out", async () => {
        await seedSevenEligible();
        send.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

        const res = await runSocialDigest({ trigger: "cron", now: NOW });

        expect(res.reason).toBe("telegram-failed");
        expect(sendDocuments).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledTimes(2);
        expect(await sentSlugs()).toEqual([]);
    });

    it("stays quiet when nothing qualifies", async () => {
        const service = await makeCompany("ServiceCo", { companyType: "service" });
        await makeJob("not-eligible", service);

        const res = await runSocialDigest({ trigger: "cron", now: NOW });

        expect(res.sent).toBe(false);
        expect(res.reason).toBe("no-eligible-jobs");
        expect(send).not.toHaveBeenCalled();
    });

    it("dry run builds the messages but neither sends nor stamps", async () => {
        await seedSevenEligible();

        const res = await runSocialDigest({ trigger: "preview", dryRun: true, now: NOW });

        expect(res.dryRun).toBe(true);
        expect(res.messages).toHaveLength(3);
        expect(slugsOf(res.jobs)).toEqual(RANKED_SIX);
        expect(send).not.toHaveBeenCalled();
        expect(renderBanners).not.toHaveBeenCalled();
        expect(await sentSlugs()).toEqual([]);
    });
});

describe("buildDigestMessages", () => {
    const job = (overrides = {}) => ({
        _id: "65f000000000000000000001",
        slug: "google-software-engineer",
        title: "Software Engineer",
        companyName: "Google",
        batch: [2025, 2026],
        degree: ["B.Tech"],
        jobLocation: [{ city: "Bengaluru" }],
        employmentType: ["FULL_TIME"],
        ...overrides,
    });

    it("lists every job with its site link and escapes HTML in the list", () => {
        const [list] = buildDigestMessages(
            [job(), job({ slug: "acme-rnd", title: "R&D <Intern>", companyName: "Acme" })],
            { now: NOW, lookbackHours: 24 }
        );

        expect(list).toContain("Top 2 jobs to post");
        expect(list).toContain(`<b>Google</b> — Software Engineer`);
        expect(list).toContain(`${SITE_URL}/jobs/google-software-engineer`);
        expect(list).toContain("R&amp;D &lt;Intern&gt;");
        expect(list).not.toContain("<Intern>");
    });

    it("sends both captions as plain text, ready to paste", () => {
        const [, caption, whatsapp] = buildDigestMessages([job()], { now: NOW, lookbackHours: 24 });

        expect(caption).toContain("Google — Software Engineer");
        expect(caption).not.toMatch(/<\/?b>/);

        expect(whatsapp).toContain(stylize("Google — Software Engineer"));
        expect(whatsapp).toContain(`Apply Here 👉 ${SITE_URL}/jobs/google-software-engineer`);
        expect(whatsapp).not.toMatch(/<\/?b>/);
    });

    it("keeps a full digest of long titles well under Telegram's cap", () => {
        const long = "Senior Associate Software Development Engineer, Platform Infrastructure and Reliability (Early Career)";
        const jobs = Array.from({ length: 6 }, (_, i) =>
            job({
                slug: `extremely-long-company-name-${i}-${"x".repeat(60)}`,
                title: long,
                companyName: `Extremely Long Company Name Private Limited ${i}`,
                degree: ["B.Tech", "B.E", "M.Tech", "M.E", "MCA", "BCA", "B.Sc", "M.Sc"],
            })
        );

        for (const text of buildDigestMessages(jobs, { now: NOW, lookbackHours: 24 })) {
            expect(text.length).toBeLessThan(MAX_MESSAGE_LEN);
        }
    });
});

describe("admin routes", () => {
    let app;
    beforeAll(() => {
        app = express();
        app.use(express.json({ limit: "1mb" }));
        app.use("/api", require("../src/modules/socialDigest/socialDigest.admin.routes"));
    });

    const auth = { "x-api-key": "test-secret-key" };

    it("requires auth", async () => {
        await request(app).get("/api/admin/social-digest/preview").expect(401);
        await request(app).post("/api/admin/social-digest/send").send({}).expect(401);
    });

    it("previews without sending", async () => {
        await seedSevenEligible(new Date());

        const res = await request(app).get("/api/admin/social-digest/preview").set(auth).expect(200);

        expect(slugsOf(res.body.data.jobs)).toEqual(RANKED_SIX);
        expect(res.body.data.messages).toHaveLength(3);
        expect(send).not.toHaveBeenCalled();
        expect(await sentSlugs()).toEqual([]);
    });

    it("sends now and stamps the jobs", async () => {
        await seedSevenEligible(new Date());

        const res = await request(app).post("/api/admin/social-digest/send").set(auth).send({}).expect(200);

        expect(res.body.data.sent).toBe(true);
        expect(send).toHaveBeenCalledTimes(3);
        expect(await sentSlugs()).toEqual([...RANKED_SIX].sort());
    });

    it("sends and stamps only the top `count` jobs when one is given", async () => {
        await seedSevenEligible(new Date());

        const res = await request(app)
            .post("/api/admin/social-digest/send")
            .set(auth)
            .send({ count: 5 })
            .expect(200);

        expect(slugsOf(res.body.data.jobs)).toEqual(RANKED_SIX.slice(0, 5));
        expect(send).toHaveBeenCalledTimes(3);
        expect(await sentSlugs()).toEqual(RANKED_SIX.slice(0, 5).sort());
    });

    it("previews the top `count` jobs when one is given", async () => {
        await seedSevenEligible(new Date());

        const res = await request(app)
            .get("/api/admin/social-digest/preview?count=5")
            .set(auth)
            .expect(200);

        expect(slugsOf(res.body.data.jobs)).toEqual(RANKED_SIX.slice(0, 5));
    });

    it("rejects a count outside 1–6", async () => {
        for (const count of [0, 7, 2.5, "5"]) {
            await request(app)
                .post("/api/admin/social-digest/send")
                .set(auth)
                .send({ count })
                .expect(400);
        }
        await request(app).get("/api/admin/social-digest/preview?count=7").set(auth).expect(400);
        expect(send).not.toHaveBeenCalled();
    });

    it("answers 200 with sent:false when nothing qualifies", async () => {
        const res = await request(app).post("/api/admin/social-digest/send").set(auth).send({}).expect(200);

        expect(res.body.data).toMatchObject({ sent: false, reason: "no-eligible-jobs", jobs: [] });
    });

    it("answers 502 and stamps nothing when Telegram refuses", async () => {
        await seedSevenEligible(new Date());
        send.mockResolvedValue(false);

        const res = await request(app).post("/api/admin/social-digest/send").set(auth).send({}).expect(502);

        expect(res.body.error).toMatch(/No job was marked as sent/);
        expect(await sentSlugs()).toEqual([]);
    });

    it("rejects options on send instead of silently sending for real", async () => {
        await request(app)
            .post("/api/admin/social-digest/send")
            .set(auth)
            .send({ dryRun: true })
            .expect(400);
        expect(send).not.toHaveBeenCalled();
    });
});

describe("socialDigest.scheduler", () => {
    it("is not scheduled unless SOCIAL_DIGEST_ENABLED is exactly 'true'", () => {
        scheduler.init();
        process.env.SOCIAL_DIGEST_ENABLED = "1";
        scheduler.init();

        expect(cron.schedule).not.toHaveBeenCalled();
    });

    it("runs daily at 16:00 Asia/Kolkata by default", () => {
        process.env.SOCIAL_DIGEST_ENABLED = "true";
        scheduler.init();

        expect(cron.schedule).toHaveBeenCalledTimes(1);
        const [expr, , opts] = cron.schedule.mock.calls[0];
        expect(expr).toBe("0 16 * * *");
        expect(opts).toEqual({ timezone: "Asia/Kolkata" });
    });

    it("skips an invalid SOCIAL_DIGEST_CRON instead of throwing", () => {
        process.env.SOCIAL_DIGEST_ENABLED = "true";
        process.env.SOCIAL_DIGEST_CRON = "not a cron";

        expect(() => scheduler.init()).not.toThrow();
        expect(cron.schedule).not.toHaveBeenCalled();
    });

    it("alerts the general channel when Telegram refuses the cron's digest", async () => {
        await seedSevenEligible(new Date());
        send.mockResolvedValue(false);
        process.env.SOCIAL_DIGEST_ENABLED = "true";
        scheduler.init();

        const [, tick] = cron.schedule.mock.calls[0];
        await tick();

        expect(notifyGeneralError).toHaveBeenCalledTimes(1);
        expect(notifyGeneralError.mock.calls[0][0]).toBe("socialDigest cron");
        expect(await sentSlugs()).toEqual([]);
    });
});
