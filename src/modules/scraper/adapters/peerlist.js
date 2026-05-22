const cheerio = require("cheerio");
const { filterKnownUrls } = require("../ingester");
const { isStopRequested } = require("../stopFlags");
const { applyAll, DROP } = require("../peerlist/filters");
const { scrubRecord, containsSourceHost } = require("../peerlist/scrub");
const { SOURCE_HOSTS } = require("../peerlist/constants");
const logger = require("../../../utils/logger");

const BASE_URL = "https://peerlist.io/jobs";
const DELAY_MS = 2500;
const MAX_PAGES = 25;

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function textOf($, el) {
    if (!el || !el.length) return "";
    return $(el).text().replace(/\s+/g, " ").trim();
}

function attrOf($, el, name) {
    if (!el || !el.length) return "";
    return ($(el).attr(name) || "").trim();
}

function parseJobCards(html) {
    const $ = cheerio.load(html);
    const records = [];

    const cardCandidates = [
        '[data-testid*="job-card"]',
        "article[role=listitem]",
        'a[href^="/jobs/"][href*="/"]',
        "div.job-card",
        "li.job-card",
    ];

    let cards = $();
    for (const sel of cardCandidates) {
        const found = $(sel);
        if (found.length > 0) {
            cards = found;
            break;
        }
    }

    if (cards.length === 0) {
        const links = $('a[href^="/jobs/"]').filter((_, a) => {
            const href = $(a).attr("href") || "";
            return /^\/jobs\/.+/.test(href);
        });
        cards = links.map((_, a) => $(a).closest("article, li, div").get(0)).filter((_, n) => !!n);
        cards = $(cards);
    }

    cards.each((_, card) => {
        try {
            const $c = $(card);

            const title = textOf(
                $,
                $c.find("h1, h2, h3").first().length
                    ? $c.find("h1, h2, h3").first()
                    : $c.find('[data-testid*="job-title"], .job-title').first()
            );

            const companyName = textOf(
                $,
                $c.find('[data-testid*="company"], .company-name, [class*="company"]').first()
            );

            const location = textOf(
                $,
                $c.find('[data-testid*="location"], [class*="location"]').first()
            );

            const experienceRange = textOf(
                $,
                $c.find('[data-testid*="experience"], [class*="experience"], [class*="exp"]').first()
            );

            const employmentType = textOf(
                $,
                $c.find('[data-testid*="employment"], [class*="employment"], [class*="job-type"]').first()
            );

            const applyAnchor = $c
                .find("a[href]")
                .filter((_, a) => {
                    const t = ($(a).text() || "").toLowerCase();
                    return t.includes("apply") || t.includes("view job");
                })
                .first();

            let applyUrl = attrOf($, applyAnchor, "href");
            const applyButtonText = textOf($, applyAnchor);

            if (applyUrl && applyUrl.startsWith("/")) {
                applyUrl = `https://peerlist.io${applyUrl}`;
            }

            const postedDate = textOf(
                $,
                $c.find('[data-testid*="posted"], time, [class*="posted"], [class*="date"]').first()
            );

            const skills = [];
            $c.find('[data-testid*="skill"], [class*="skill"], [class*="tag"], [class*="chip"]').each((_, s) => {
                const t = textOf($, $(s));
                if (t && t.length < 40) skills.push(t);
            });

            const compensation = textOf(
                $,
                $c.find('[data-testid*="salary"], [class*="salary"], [class*="compensation"]').first()
            );

            const descriptionSnippet = textOf(
                $,
                $c.find("p, [class*='description'], [class*='summary']").first()
            );

            if (!title && !applyUrl) return;

            records.push({
                title,
                companyName,
                location,
                experienceRange,
                employmentType,
                applyUrl,
                applyButtonText,
                postedDate,
                skills: Array.from(new Set(skills)),
                compensation,
                descriptionSnippet,
            });
        } catch (err) {
            logger.warn(`[peerlist] card-parse error: ${err.message}`);
        }
    });

    return records;
}

function formatPageContent(record) {
    const parts = [
        `Job Title: ${record.title}`,
        `Company: ${record.companyName}`,
        `Location: ${record.location || "Not specified"}`,
        `Job Type: ${record.employmentType || "Not specified"}`,
        `Experience Required: ${record.experienceRange || "Not specified"}`,
    ];

    if (record.compensation) {
        parts.push(`Salary: ${record.compensation}`);
    }
    if (record.skills && record.skills.length > 0) {
        parts.push(`Skills: ${record.skills.join(", ")}`);
    }
    if (record.descriptionSnippet) {
        parts.push("", "Job Description:", record.descriptionSnippet);
    }
    parts.push("", `Apply URL: ${record.applyUrl}`);
    if (record.postedDate) {
        parts.push(`Posted: ${record.postedDate}`);
    }

    return parts.join("\n").slice(0, 8000);
}

module.exports = {
    name: "peerlist",
    displayName: "Peerlist",
    baseUrl: BASE_URL,
    enabled: false,

    selectors: { jobLinks: { limit: 50 }, companyUrl: {}, meta: {} },
    options: { delayMs: DELAY_MS, headers: {}, pagination: { enabled: true, maxPages: MAX_PAGES } },

    notes:
        "Peerlist HTML scrape. India-only, junior (≤5y), external-apply only. Identity-scrubbed. " +
        "selectors here are placeholders — parseJobCards() drives extraction.",

    parseJobCards,
    formatPageContent,

    async scrape(options = {}) {
        const fetchPage = options.fetchPageImpl || require("../scraper.fetch").fetchPage;
        const limit = options.limit || this.selectors.jobLinks.limit;
        const maxPages = options.maxPages || MAX_PAGES;

        const stats = {
            jobLinksFound: 0,
            jobsFetched: 0,
            errors: [],
            dropCounts: {
                [DROP.APPLY]: 0,
                [DROP.LOCATION]: 0,
                [DROP.SENIORITY]: 0,
                [DROP.IDENTITY]: 0,
            },
        };
        const jobs = [];
        let prevApplyUrls = new Set();

        for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
            if (isStopRequested(this.name)) {
                logger.info(`[peerlist] stop requested, aborting at page ${pageNum}`);
                stats.stopped = true;
                break;
            }
            if (jobs.length >= limit) break;
            if (pageNum > 1) await sleep(DELAY_MS);

            const url = `${BASE_URL}?page=${pageNum}`;
            let html;
            try {
                html = await fetchPage(url, options.headers || {});
            } catch (err) {
                logger.warn(`[peerlist] fetch failed page ${pageNum}: ${err.message}`);
                stats.errors.push({ jobUrl: url, step: "fetch", message: err.message });
                break;
            }

            const records = (options.parseImpl || parseJobCards)(html);
            stats.jobLinksFound += records.length;

            if (records.length === 0) {
                logger.info(`[peerlist] page ${pageNum}: 0 records, stopping`);
                break;
            }

            const currentApplyUrls = new Set(records.map((r) => r.applyUrl).filter(Boolean));
            const everySeen = currentApplyUrls.size > 0
                && [...currentApplyUrls].every((u) => prevApplyUrls.has(u));

            const passing = [];
            for (const raw of records) {
                const decision = applyAll(raw);
                if (!decision.keep) {
                    stats.dropCounts[decision.reason] = (stats.dropCounts[decision.reason] || 0) + 1;
                    continue;
                }
                const cleaned = scrubRecord(raw);
                if (containsSourceHost(cleaned.applyUrl)) {
                    stats.dropCounts[DROP.APPLY]++;
                    continue;
                }
                passing.push(cleaned);
            }

            const candidateUrls = passing.map((r) => r.applyUrl);
            const knownUrls = candidateUrls.length ? await filterKnownUrls(candidateUrls) : new Set();

            for (const rec of passing) {
                if (jobs.length >= limit) break;
                if (knownUrls.has(rec.applyUrl)) continue;
                if (SOURCE_HOSTS.some((h) => rec.applyUrl.toLowerCase().includes(h))) {
                    stats.dropCounts[DROP.APPLY]++;
                    continue;
                }

                jobs.push({
                    source: this.name,
                    sourceUrl: rec.applyUrl,
                    companyPageUrl: null,
                    meta: {
                        title: rec.title,
                        company: rec.companyName,
                        postedDate: rec.postedDate || null,
                    },
                    pageContent: formatPageContent(rec),
                    companyPageContent: null,
                });
                stats.jobsFetched++;
            }

            if (everySeen) {
                logger.info(`[peerlist] page ${pageNum}: all duplicates of previous page, stopping`);
                break;
            }
            prevApplyUrls = currentApplyUrls;
        }

        logger.info(
            `[peerlist] scrape done: links=${stats.jobLinksFound} fetched=${stats.jobsFetched} ` +
            `drops=${JSON.stringify(stats.dropCounts)}`
        );

        return { jobs, stats };
    },
};
