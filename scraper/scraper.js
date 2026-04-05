const axios = require("axios");
const cheerio = require("cheerio");
const adapters = require("./adapters");
const { filterKnownUrls } = require("./ingester");

const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveUrl(base, href) {
    if (!href) return null;
    try {
        return new URL(href, base).href;
    } catch {
        return null;
    }
}

function stripHtml(html) {
    const $ = cheerio.load(html);
    $("script, style, nav, header, footer, iframe, noscript").remove();
    return $("body").text().replace(/\s+/g, " ").trim();
}

function buildFetchUrl(url) {
    // ScraperAPI: 5000 free requests/month — https://www.scraperapi.com/
    if (process.env.SCRAPERAPI_KEY) {
        return `http://api.scraperapi.com?api_key=${process.env.SCRAPERAPI_KEY}&url=${encodeURIComponent(url)}&render=false`;
    }
    return url;
}

async function fetchPage(url, headers = {}) {
    const fetchUrl = buildFetchUrl(url);
    const isProxy = fetchUrl !== url;

    const response = await axios.get(fetchUrl, {
        headers: isProxy
            ? {} // proxy handles headers
            : {
                  "User-Agent": USER_AGENT,
                  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                  "Accept-Language": "en-US,en;q=0.9",
                  "Accept-Encoding": "gzip, deflate, br",
                  "Cache-Control": "no-cache",
                  "Pragma": "no-cache",
                  "Sec-Fetch-Dest": "document",
                  "Sec-Fetch-Mode": "navigate",
                  "Sec-Fetch-Site": "none",
                  "Sec-Fetch-User": "?1",
                  "Upgrade-Insecure-Requests": "1",
                  ...headers,
              },
        timeout: isProxy ? 30000 : 15000,
        maxRedirects: 5,
    });
    return response.data;
}

async function scrapeOne(adapter, options = {}) {
    if (typeof adapter.scrape === "function") {
        console.log(`[Scraper] Starting ${adapter.displayName} (custom scrape)`);
        return adapter.scrape(options);
    }

    const limit = options.limit || adapter.selectors.jobLinks.limit;
    const stats = {
        jobLinksFound: 0,
        jobsFetched: 0,
        errors: [],
    };

    console.log(`[Scraper] Starting ${adapter.displayName} (${adapter.baseUrl})`);

    // Step 1: Fetch homepage and extract job links
    let allLinks = [];
    let currentUrl = adapter.baseUrl;
    let pagesScraped = 0;
    const maxPages = adapter.options.pagination.enabled
        ? adapter.options.pagination.maxPages
        : 1;

    while (currentUrl && pagesScraped < maxPages) {
        const html = await fetchPage(currentUrl, adapter.options.headers);
        const $ = cheerio.load(html);

        const pageLinks = $(adapter.selectors.jobLinks.selector)
            .map((_, el) => $(el).attr(adapter.selectors.jobLinks.attribute))
            .get()
            .filter(Boolean)
            .map((href) => resolveUrl(currentUrl, href));

        allLinks = allLinks.concat(pageLinks);
        pagesScraped++;

        // Check for next page
        if (adapter.options.pagination.enabled && adapter.options.pagination.nextPageSelector) {
            const nextHref = $(adapter.options.pagination.nextPageSelector).attr("href");
            currentUrl = nextHref ? resolveUrl(currentUrl, nextHref) : null;
        } else {
            currentUrl = null;
        }
    }

    allLinks = [...new Set(allLinks)].filter(Boolean).slice(0, limit);
    stats.jobLinksFound = allLinks.length;

    if (allLinks.length === 0) {
        throw new Error(
            `No job links found with selector "${adapter.selectors.jobLinks.selector}". Site may have changed.`
        );
    }

    // Skip pages already in staging or live
    const knownUrls = await filterKnownUrls(allLinks);
    if (knownUrls.size > 0) {
        const before = allLinks.length;
        allLinks = allLinks.filter((url) => !knownUrls.has(url));
        console.log(`[Scraper] ${adapter.displayName}: skipped ${before - allLinks.length} already-known URLs`);
    }

    console.log(`[Scraper] ${adapter.displayName}: found ${allLinks.length} new job links (${stats.jobLinksFound} total)`);

    // Step 2: Visit each sub-page and extract data
    const jobs = [];

    for (const link of allLinks) {
        try {
            await delay(adapter.options.delayMs);

            const pageHtml = await fetchPage(link, adapter.options.headers);
            const $page = cheerio.load(pageHtml);

            // Extract metadata
            const title = adapter.selectors.meta.title
                ? $page(adapter.selectors.meta.title).first().text().trim()
                : null;

            const company = adapter.selectors.meta.company
                ? $page(adapter.selectors.meta.company).first().text().trim()
                : null;

            const postedDate = adapter.selectors.meta.postedDate
                ? $page(adapter.selectors.meta.postedDate).first().text().trim()
                : null;

            // Get company career page URL
            let companyUrl = $page(adapter.selectors.companyUrl.selector)
                .first()
                .attr(adapter.selectors.companyUrl.attribute);

            if (!companyUrl && adapter.selectors.companyUrl.fallbackSelector) {
                companyUrl = $page(adapter.selectors.companyUrl.fallbackSelector)
                    .first()
                    .attr(adapter.selectors.companyUrl.attribute);
            }

            companyUrl = resolveUrl(link, companyUrl);

            // Get full page content for AI processing
            const pageContent = stripHtml(pageHtml);

            // Step 3: Fetch company career page content if URL found
            let companyPageContent = null;
            if (companyUrl) {
                try {
                    await delay(adapter.options.delayMs);
                    const companyHtml = await fetchPage(companyUrl, adapter.options.headers);
                    companyPageContent = stripHtml(companyHtml).slice(0, 5000);
                } catch (err) {
                    console.log(
                        `[Scraper] ${adapter.displayName}: failed to fetch company page ${companyUrl}: ${err.message}`
                    );
                }
            }

            stats.jobsFetched++;
            jobs.push({
                source: adapter.name,
                sourceUrl: link,
                companyPageUrl: companyUrl,
                meta: { title, company, postedDate },
                pageContent: pageContent.slice(0, 8000),
                companyPageContent,
            });
        } catch (err) {
            console.log(
                `[Scraper] ${adapter.displayName}: error fetching ${link}: ${err.message}`
            );
            stats.errors.push({
                jobUrl: link,
                step: "fetch",
                message: err.message,
            });
        }
    }

    console.log(
        `[Scraper] ${adapter.displayName}: fetched ${stats.jobsFetched}/${stats.jobLinksFound} jobs`
    );

    return { jobs, stats };
}

async function scrapeAll() {
    const results = [];

    for (const adapter of adapters) {
        const startTime = Date.now();
        try {
            const { jobs, stats } = await scrapeOne(adapter);
            results.push({
                adapter: adapter.name,
                jobs,
                stats: {
                    ...stats,
                    durationMs: Date.now() - startTime,
                    status: stats.errors.length === 0 ? "success" : "partial",
                },
            });
        } catch (err) {
            console.error(`[Scraper] ${adapter.displayName} failed: ${err.message}`);
            results.push({
                adapter: adapter.name,
                jobs: [],
                stats: {
                    jobLinksFound: 0,
                    jobsFetched: 0,
                    errors: [{ jobUrl: adapter.baseUrl, step: "fetch", message: err.message }],
                    durationMs: Date.now() - startTime,
                    status: "failed",
                },
            });
        }
    }

    return results;
}

function getAdapterByName(name) {
    const all = require("./adapters/index");
    // Also check disabled adapters for testing
    const fs = require("fs");
    const path = require("path");
    const skipFiles = ["_template.js", "index.js"];
    const allAdapters = fs
        .readdirSync(path.join(__dirname, "adapters"))
        .filter((file) => file.endsWith(".js") && !skipFiles.includes(file))
        .map((file) => require(path.join(__dirname, "adapters", file)));

    return allAdapters.find((a) => a.name === name) || null;
}

module.exports = { scrapeOne, scrapeAll, getAdapterByName };
