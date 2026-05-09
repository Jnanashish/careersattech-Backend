const axios = require("axios");

let warned = false;

function isConfigured() {
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
        return true;
    }
    if (!warned) {
        console.log("[Notifier] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — Telegram alerts disabled");
        warned = true;
    }
    return false;
}

async function send(text) {
    if (!isConfigured()) return;

    try {
        await axios.post(
            `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
                chat_id: process.env.TELEGRAM_CHAT_ID,
                text,
                parse_mode: "HTML",
            },
            { timeout: 10000 }
        );
    } catch (err) {
        console.error(`[Notifier] Failed to send Telegram message: ${err.message}`);
    }
}

async function sendScrapeReport(scrapeLog) {
    const s = scrapeLog.summary;
    const adapterLines = scrapeLog.adapters
        .map((a) => {
            const icon = a.status === "success" ? "✅" : a.status === "partial" ? "⚠️" : "❌";
            return `${icon} <b>${a.name}</b>: ${a.jobsIngested || 0} new, ${a.jobsSkipped || 0} skipped`;
        })
        .join("\n");

    const text =
        `<b>🔍 Scrape Run Complete</b>\n` +
        `Trigger: ${scrapeLog.trigger}\n` +
        `AI: ${scrapeLog.aiProvider}\n\n` +
        `${adapterLines}\n\n` +
        `<b>Total:</b> ${s.totalNew} new | ${s.totalSkipped} skipped | ${s.totalErrors} errors`;

    await send(text);
}

async function sendAdapterAlert(adapterName, baseUrl, error) {
    const text =
        `<b>⚠️ Adapter Failed</b>\n` +
        `Adapter: <b>${adapterName}</b>\n` +
        `URL: ${baseUrl}\n` +
        `Error: <code>${error}</code>`;

    await send(text);
}

async function sendRepeatedFailureAlert(adapterName, consecutiveFailures) {
    const text =
        `<b>🚨 Repeated Failures</b>\n` +
        `Adapter: <b>${adapterName}</b>\n` +
        `Consecutive failures: <b>${consecutiveFailures}</b>\n\n` +
        `Consider checking the site or setting <code>enabled: false</code> in the adapter config.`;

    await send(text);
}

async function sendCriticalAlert(message) {
    const text = `<b>🔴 CRITICAL ERROR</b>\n\n<code>${message}</code>`;
    await send(text);
}

module.exports = {
    sendScrapeReport,
    sendAdapterAlert,
    sendRepeatedFailureAlert,
    sendCriticalAlert,
};
