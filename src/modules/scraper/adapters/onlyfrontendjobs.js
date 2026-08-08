const axios = require("axios");
const { filterKnownUrls } = require("../ingester");
const { fetchApplyPageContent } = require("../applyPageContent");
const logger = require("../../../utils/logger");

const API_BASE = "https://www.onlyfrontendjobs.com/api/jobs";
const PAGE_SIZE = 10;
const MAX_JOBS = 100;
const MAX_PAGE_CONTENT = 16000;
const APPLY_FETCH_DELAY_MS = 1000;

function sleep(ms) {
    return new Promise((r) => setTimeout(r,ms));
}

function formatPageContent(job,applyPage) {
    const parts = [
        `Job Title: ${job.title}`,
        `Company: ${job.company}`,
        `Location: ${job.location || "Not specified"}`,
        `Job Type: ${job.job_type || "Not specified"}`,
        `Experience Level: ${job.experience_level || "Not specified"}`,
        `Experience Required: ${job.experience_years || "Not specified"}`,
    ];

    if (job.salary_min || job.salary_max) {
        const currency = job.salary_currency || "INR";
        const min = job.salary_min ? `${currency} ${job.salary_min}` : "";
        const max = job.salary_max ? `${currency} ${job.salary_max}` : "";
        parts.push(`Salary: ${[min,max].filter(Boolean).join(" - ")}`);
    }

    if (job.tech_stack && job.tech_stack.length > 0) {
        parts.push(`Tech Stack: ${job.tech_stack.join(", ")}`);
    }

    if (job.apply_url) {
        parts.push("",`Apply URL: ${job.apply_url}`);
    }

    if (job.linkedin_post_url) {
        parts.push(`LinkedIn Post: ${job.linkedin_post_url}`);
    }

    const flags = [];
    if (job.is_featured) flags.push("Featured");
    if (job.is_hot) flags.push("Hot");
    if (job.is_high_signal) flags.push("High Signal");
    if (job.is_high_pay) flags.push("High Pay");
    if (flags.length > 0) {
        parts.push(`Tags: ${flags.join(", ")}`);
    }

    // short_pitch is the only prose the list API actually returns. The
    // `description` field this adapter used to read has never been present on
    // the response, which is why transformed JDs came out at ~40 words.
    if (job.short_pitch) {
        parts.push("",`Summary: ${job.short_pitch}`);
    }

    // Long-form content goes last so the length cap trims the tail of the
    // description rather than dropping the metadata above it.
    if (applyPage && applyPage.text) {
        parts.push("",`OFFICIAL JOB POSTING (fetched from ${job.apply_url}):`,applyPage.text);
    } else if (job.description) {
        parts.push("","Job Description:",job.description);
    }

    return parts.join("\n").slice(0,MAX_PAGE_CONTENT);
}

module.exports = {
    name: "onlyfrontendjobs",
    displayName: "OnlyFrontendJobs",
    baseUrl: "https://www.onlyfrontendjobs.com",
    enabled: true,

    selectors: { jobLinks: { limit: 20 },companyUrl: {},meta: {} },
    options: { delayMs: 1000,headers: {},pagination: { enabled: false } },

    formatPageContent,

    async scrape(options = {}) {
        const limit = options.limit || this.selectors.jobLinks.limit;
        const fetchPageImpl = options.fetchPageImpl;
        // No delay when a fetcher is injected — that means no real network.
        const applyDelayMs = options.applyDelayMs != null
            ? options.applyDelayMs
            : (fetchPageImpl ? 0 : APPLY_FETCH_DELAY_MS);
        const stats = { jobLinksFound: 0,jobsFetched: 0,applyPagesFetched: 0,applyPagesMissed: 0,errors: [] };
        const jobs = [];

        let skip = 0;
        let total = Infinity;

        while (skip < total && jobs.length < limit && skip < MAX_JOBS) {
            const batchSize = Math.min(PAGE_SIZE,limit - jobs.length);
            const url = `${API_BASE}?sort_by=newest&skip=${skip}&limit=${batchSize}`;

            try {
                const { data } = await axios.get(url,{ timeout: 15000 });

                if (!data.success || !Array.isArray(data.jobs)) {
                    stats.errors.push({ jobUrl: url,step: "fetch",message: "API returned unsuccessful or malformed response" });
                    break;
                }

                total = data.total;
                stats.jobLinksFound = total;

                if (data.jobs.length === 0) break;

                const publishedJobs = data.jobs.filter((j) => j.status === "published");
                const candidateUrls = publishedJobs.flatMap((j) => {
                    const urls = [`https://www.onlyfrontendjobs.com/jobs/${j.slug}`];
                    if (j.apply_url) urls.push(j.apply_url);
                    return urls;
                });
                const knownUrls = await filterKnownUrls(candidateUrls);

                for (const job of publishedJobs) {
                    const sourceUrl = `https://www.onlyfrontendjobs.com/jobs/${job.slug}`;
                    if (knownUrls.has(sourceUrl) || (job.apply_url && knownUrls.has(job.apply_url))) {
                        continue;
                    }

                    // The list API carries no description, so follow the apply
                    // link to the company's own posting — that page is the only
                    // source of real JD text in this pipeline.
                    const applyPage = await fetchApplyPageContent(job.apply_url,{ fetchPageImpl });
                    if (applyPage) stats.applyPagesFetched++;
                    else stats.applyPagesMissed++;

                    jobs.push({
                        source: "onlyfrontendjobs",
                        sourceUrl,
                        companyPageUrl: job.apply_url || null,
                        meta: {
                            title: job.title,
                            company: job.company,
                            postedDate: job.published_at,
                        },
                        pageContent: formatPageContent(job,applyPage),
                        // Deliberately null: the apply page is already embedded
                        // in pageContent above, and sending it twice just
                        // doubles the transformer's token bill.
                        companyPageContent: null,
                    });

                    stats.jobsFetched++;
                    if (jobs.length >= limit) break;
                    if (applyDelayMs) await sleep(applyDelayMs);
                }

                skip += batchSize;

                if (skip < total && jobs.length < limit) {
                    await new Promise((r) => setTimeout(r,1000));
                }
            } catch (err) {
                stats.errors.push({ jobUrl: url,step: "fetch",message: err.message });
                break;
            }
        }

        logger.info(
            `[Scraper] OnlyFrontendJobs: fetched ${stats.jobsFetched} jobs (API total: ${total}); ` +
            `apply pages extracted ${stats.applyPagesFetched}, unavailable ${stats.applyPagesMissed}`
        );
        return { jobs,stats };
    },
};
