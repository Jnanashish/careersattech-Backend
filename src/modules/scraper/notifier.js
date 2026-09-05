const { send, esc } = require("../../utils/telegram");

// Scrape-run alerts. Transport, channel routing and HTML escaping live in
// utils/telegram; this module only decides what each message says and which
// channel it belongs in:
//   scraper — anything that failed during a run
//   jobs    — the published-job list for a completed run
// General backend errors do not pass through here; they go straight to
// utils/telegram.notifyGeneralError.

// Telegram caps a message at 4096 chars and a big run can publish far more jobs
// than fit. List this many, then summarise the rest as a count.
const MAX_LISTED_JOBS = 25;

function jobLine(job, index) {
    const role = esc(job.title || "(untitled)");
    const company = esc(job.companyName || "(unknown company)");
    const applyLink = job.applyLink ? `\n   ${esc(job.applyLink)}` : "";
    return `${index + 1}. <b>${role}</b> @ ${company}${applyLink}`;
}

/**
 * The run's published jobs, with role, company and apply URL for each.
 *
 * @param {{ title: string, companyName: string, applyLink: string }[]} jobs
 * @param {{ trigger?: string, failed?: number }} [meta]
 */
async function sendScrapedJobs(jobs, meta = {}) {
    // A run that published nothing is normal (everything was a duplicate), and
    // a daily "0 jobs" post trains you to ignore the channel. Stay quiet.
    if (!Array.isArray(jobs) || jobs.length === 0) return;

    const listed = jobs.slice(0, MAX_LISTED_JOBS).map(jobLine).join("\n");
    const overflow =
        jobs.length > MAX_LISTED_JOBS
            ? `\n\n<i>…and ${jobs.length - MAX_LISTED_JOBS} more</i>`
            : "";
    const failedNote = meta.failed ? `\n<i>${meta.failed} left in staging</i>` : "";

    const text =
        `<b>📋 Scraped Jobs: ${jobs.length} published</b>` +
        (meta.trigger ? `\nTrigger: ${esc(meta.trigger)}` : "") +
        `${failedNote}\n\n${listed}${overflow}`;

    await send(text, "jobs");
}

async function sendScrapeReport(scrapeLog) {
    const s = scrapeLog.summary;
    const adapterLines = scrapeLog.adapters
        .map((a) => {
            const icon = a.status === "success" ? "✅" : a.status === "partial" ? "⚠️" : "❌";
            const published = a.jobsPublished ? `, ${a.jobsPublished} published` : "";
            // Surface the first error inline. A count alone can't tell a dead
            // model ID from a rate limit, which is the whole reason a run can
            // fail silently for days.
            const firstError = a.status !== "success" && a.errors?.length
                ? `\n   ↳ <code>${esc(a.errors[0].message || a.errors[0])}</code>`
                : "";
            return `${icon} <b>${esc(a.name)}</b>: ${a.jobsIngested || 0} new${published}, ${a.jobsSkipped || 0} skipped${firstError}`;
        })
        .join("\n");

    const backlogNote = s.totalBacklogPublished ? ` (${s.totalBacklogPublished} from backlog)` : "";
    const publishedTotal = s.totalPublished ? ` | ${s.totalPublished} published${backlogNote}` : "";
    const text =
        `<b>🔍 Scrape Run Complete</b>\n` +
        `Trigger: ${esc(scrapeLog.trigger)}\n` +
        `AI: ${esc(scrapeLog.aiProvider)}\n\n` +
        `${adapterLines}\n\n` +
        `<b>Total:</b> ${s.totalNew} new${publishedTotal} | ${s.totalSkipped} skipped | ${s.totalErrors} errors`;

    // The run summary is a scrape-health message, not a job listing — the jobs
    // channel gets sendScrapedJobs instead.
    await send(text, "scraper");
}

async function sendAdapterAlert(adapterName, baseUrl, error) {
    const text =
        `<b>⚠️ Adapter Failed</b>\n` +
        `Adapter: <b>${esc(adapterName)}</b>\n` +
        `URL: ${esc(baseUrl)}\n` +
        `Error: <code>${esc(error)}</code>`;

    await send(text, "scraper");
}

async function sendRepeatedFailureAlert(adapterName, consecutiveFailures) {
    const text =
        `<b>🚨 Repeated Failures</b>\n` +
        `Adapter: <b>${esc(adapterName)}</b>\n` +
        `Consecutive failures: <b>${consecutiveFailures}</b>\n\n` +
        `Consider checking the site or setting <code>enabled: false</code> in the adapter config.`;

    await send(text, "scraper");
}

async function sendCriticalAlert(message) {
    const text = `<b>🔴 CRITICAL ERROR</b>\n\n<code>${esc(message)}</code>`;
    await send(text, "scraper");
}

module.exports = {
    sendScrapeReport,
    sendScrapedJobs,
    sendAdapterAlert,
    sendRepeatedFailureAlert,
    sendCriticalAlert,
};
