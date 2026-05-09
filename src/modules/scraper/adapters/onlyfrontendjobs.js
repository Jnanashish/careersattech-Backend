const axios = require("axios");
const { filterKnownUrls } = require("../ingester");

const API_BASE = "https://www.onlyfrontendjobs.com/api/jobs";
const PAGE_SIZE = 10;
const MAX_JOBS = 100;

function formatPageContent(job) {
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

    if (job.description) {
        parts.push("","Job Description:",job.description);
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

    return parts.join("\n").slice(0,8000);
}

module.exports = {
    name: "onlyfrontendjobs",
    displayName: "OnlyFrontendJobs",
    baseUrl: "https://www.onlyfrontendjobs.com",
    enabled: true,

    selectors: { jobLinks: { limit: 20 },companyUrl: {},meta: {} },
    options: { delayMs: 1000,headers: {},pagination: { enabled: false } },

    async scrape(options = {}) {
        const limit = options.limit || this.selectors.jobLinks.limit;
        const stats = { jobLinksFound: 0,jobsFetched: 0,errors: [] };
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

                    jobs.push({
                        source: "onlyfrontendjobs",
                        sourceUrl,
                        companyPageUrl: job.apply_url || null,
                        meta: {
                            title: job.title,
                            company: job.company,
                            postedDate: job.published_at,
                        },
                        pageContent: formatPageContent(job),
                        companyPageContent: null,
                    });

                    stats.jobsFetched++;
                    if (jobs.length >= limit) break;
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

        console.log(`[Scraper] OnlyFrontendJobs: fetched ${stats.jobsFetched} jobs (API total: ${total})`);
        return { jobs,stats };
    },
};
