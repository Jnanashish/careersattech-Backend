#!/usr/bin/env node

/**
 * Test an adapter's selectors without saving to DB.
 * Usage: node scraper/test-adapter.js <adapter-name>
 * Example: node scraper/test-adapter.js offcampusjobs4u
 */

const { scrapeOne, getAdapterByName } = require("./scraper");

const adapterName = process.argv[2];

if (!adapterName) {
    console.error("Usage: node scraper/test-adapter.js <adapter-name>");
    console.error("Available adapters:");
    const adapters = require("./adapters");
    const fs = require("fs");
    const path = require("path");
    const skipFiles = ["_template.js", "index.js"];
    fs.readdirSync(path.join(__dirname, "adapters"))
        .filter((f) => f.endsWith(".js") && !skipFiles.includes(f))
        .forEach((f) => {
            const a = require(path.join(__dirname, "adapters", f));
            console.error(`  ${a.name} ${a.enabled ? "" : "(disabled)"}`);
        });
    process.exit(1);
}

(async () => {
    const adapter = getAdapterByName(adapterName);
    if (!adapter) {
        console.error(`Adapter "${adapterName}" not found.`);
        process.exit(1);
    }

    console.log(`\nTesting adapter: ${adapter.displayName}`);
    console.log(`URL: ${adapter.baseUrl}`);
    console.log(`Scraping up to 3 jobs...\n`);

    try {
        const { jobs, stats } = await scrapeOne(adapter, { limit: 3 });

        console.log(`\n--- Results ---`);
        console.log(`Links found: ${stats.jobLinksFound}`);
        console.log(`Jobs fetched: ${stats.jobsFetched}`);
        console.log(`Errors: ${stats.errors.length}\n`);

        for (const job of jobs) {
            console.log(`Title: ${job.meta.title || "(not extracted)"}`);
            console.log(`Company: ${job.meta.company || "(not extracted)"}`);
            console.log(`Source URL: ${job.sourceUrl}`);
            console.log(`Company URL: ${job.companyPageUrl || "(not found)"}`);
            console.log(`Content snippet: ${job.pageContent?.slice(0, 200)}...`);
            console.log("---");
        }

        if (stats.errors.length > 0) {
            console.log(`\nErrors:`);
            stats.errors.forEach((e) => console.log(`  ${e.jobUrl}: ${e.message}`));
        }
    } catch (err) {
        console.error(`\nAdapter test failed: ${err.message}`);
    }

    process.exit(0);
})();
