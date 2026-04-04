#!/usr/bin/env node

/**
 * Test the current AI provider with sample job content.
 * Usage: node scraper/test-provider.js
 *
 * Set AI_PROVIDER env var to test different providers.
 * Default: gemini
 */

require("dotenv").config();

const { getProvider } = require("./providers");
const { SYSTEM_PROMPT } = require("./transformer");

const SAMPLE_INPUT = JSON.stringify({
    sourceUrl: "https://example.com/jobs/software-engineer-freshers",
    companyPageUrl: "https://careers.techcorp.com/jobs/12345",
    meta: {
        title: "Software Engineer - Freshers (2024/2025 Batch)",
        company: "TechCorp India",
        postedDate: "2 days ago",
    },
    pageContent:
        "TechCorp India is hiring Software Engineers for freshers from 2024 and 2025 batch. " +
        "Location: Bengaluru, Karnataka. Work Mode: Hybrid. " +
        "Requirements: B.Tech/B.E in Computer Science or related field. " +
        "Skills: Java, Python, SQL, Data Structures, Algorithms. " +
        "Experience: 0-1 years. Salary: 6-10 LPA. " +
        "Responsibilities: Develop and maintain software applications. " +
        "Write clean, testable code. Participate in code reviews. " +
        "Collaborate with cross-functional teams. " +
        "Benefits: Health insurance, flexible work hours, learning budget. " +
        "TechCorp is a leading product company specializing in cloud solutions. " +
        "Apply before 30th April 2025.",
    companyPageContent: null,
});

(async () => {
    try {
        const provider = getProvider();
        console.log(`Testing provider: ${provider.name}`);
        console.log(`Sending sample job content...\n`);

        const response = await provider.complete(SYSTEM_PROMPT, SAMPLE_INPUT);

        console.log("--- Raw Response ---");
        console.log(response);

        console.log("\n--- Parsed ---");
        const cleaned = response.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
        const parsed = JSON.parse(cleaned);
        console.log(JSON.stringify(parsed, null, 2));

        // Validate key fields
        console.log("\n--- Validation ---");
        console.log(`title: ${parsed.title ? "✅" : "❌"}`);
        console.log(`link: ${parsed.link ? "✅" : "❌"}`);
        console.log(`jobdesc: ${parsed.jobdesc ? "✅" : "❌"}`);
        console.log(`companyName: ${parsed.companyName ? "✅" : "❌"}`);
        console.log(`category: ${parsed.category ? "✅" : "❌"}`);
        console.log(`workMode: ${parsed.workMode ? "✅" : "❌"}`);
        console.log(`tags: ${Array.isArray(parsed.tags) ? "✅" : "❌"}`);
        console.log(`skilltags: ${Array.isArray(parsed.skilltags) ? "✅" : "❌"}`);
    } catch (err) {
        console.error(`\nProvider test failed: ${err.message}`);
    }

    process.exit(0);
})();
