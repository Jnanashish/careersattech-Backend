const axios = require("axios");
const config = require("../config");
const logger = require("./logger");

// Three destinations, one bot. The bot token is per-bot; the chat ID is per
// channel, so a single token posts to all three.
//
//   scraper — anything the scrape pipeline failed at
//   general — important backend errors (500s, process-level crashes)
//   jobs    — the run's published-job list
//
// The chat IDs are pinned in config (TELEGRAM_CHANNELS); only the bot token
// comes from env.
const CHANNELS = {
    scraper: () => config.telegram.scraperErrorsChatId,
    general: () => config.telegram.generalErrorsChatId,
    jobs: () => config.telegram.jobsChatId,
};

// Telegram hard-caps a sendMessage payload at 4096 characters and rejects the
// whole message if it runs over, so trim with room to spare for the suffix.
const MAX_MESSAGE_LEN = 3900;

// A 500 in a hot request path can fire hundreds of times a minute. Telegram
// throttles a channel at roughly 20 messages/minute and would start dropping
// them, so identical errors collapse into one message per window and the
// repeats are counted instead of sent.
const THROTTLE_WINDOW_MS = 5 * 60 * 1000;
const throttle = new Map();

const warned = new Set();

// parse_mode: "HTML" makes Telegram reject any message containing a stray "<"
// or "&" — which error stacks and job titles both produce. Unescaped content
// means the alert silently never arrives, so every interpolated value goes
// through here.
function esc(value) {
    return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function truncate(text) {
    if (text.length <= MAX_MESSAGE_LEN) return text;
    return `${text.slice(0, MAX_MESSAGE_LEN)}\n\n<i>…truncated</i>`;
}

function resolveChat(channel) {
    if (!config.telegram.botToken) {
        if (!warned.has("token")) {
            logger.info("[Telegram] TELEGRAM_BOT_TOKEN not set — all alerts disabled");
            warned.add("token");
        }
        return null;
    }

    const resolver = CHANNELS[channel];
    const chatId = resolver ? resolver() : null;
    if (!chatId) {
        if (!warned.has(channel)) {
            logger.info(
                `[Telegram] No chat ID for "${channel}" — set it in ` +
                `TELEGRAM_CHANNELS in src/config/index.js; ` +
                `"${channel}" alerts disabled`
            );
            warned.add(channel);
        }
        return null;
    }

    return chatId;
}

/**
 * Fire-and-forget. Never throws and never rejects: an alert failing must not
 * take down the request or pipeline that was trying to report a problem.
 */
async function send(text, channel) {
    const chatId = resolveChat(channel);
    if (!chatId) return false;

    try {
        await axios.post(
            `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`,
            {
                chat_id: chatId,
                text: truncate(text),
                parse_mode: "HTML",
                disable_web_page_preview: true,
            },
            { timeout: 10000 }
        );
        return true;
    } catch (err) {
        // Log the Telegram API's own reason when it gives one — "chat not found"
        // and "bot is not a member" are the two setup mistakes worth naming.
        const detail = err.response?.data?.description || err.message;
        logger.error(`[Telegram] Failed to send to "${channel}": ${detail}`);
        return false;
    }
}

// Drop throttle entries that have aged out, so a long-lived process with many
// distinct error signatures doesn't grow the map without bound.
function pruneThrottle(now) {
    for (const [key, entry] of throttle) {
        if (now - entry.at > THROTTLE_WINDOW_MS) throttle.delete(key);
    }
}

/**
 * Returns the suppressed-repeat count to report, or null when this signature is
 * still inside its window and should stay quiet.
 */
function claimThrottleSlot(key) {
    const now = Date.now();
    pruneThrottle(now);

    const entry = throttle.get(key);
    if (entry && now - entry.at < THROTTLE_WINDOW_MS) {
        entry.suppressed++;
        return null;
    }

    const suppressed = entry ? entry.suppressed : 0;
    throttle.set(key, { at: now, suppressed: 0 });
    return suppressed;
}

/**
 * Important backend errors only — 500s and process-level crashes. Expected 4xx
 * (validation, bad id, duplicate) are normal traffic and never come through
 * here, otherwise the channel becomes noise nobody reads.
 *
 * @param {string} context where it happened, e.g. "POST /api/jobs/v2"
 * @param {Error|string} err
 * @param {{ fatal?: boolean }} [opts] fatal marks a crash-level event
 */
async function notifyGeneralError(context, err, opts = {}) {
    const message = err && err.message ? err.message : String(err);
    const suppressed = claimThrottleSlot(`${context}::${message}`);
    if (suppressed === null) return false;

    const stack = err && err.stack ? err.stack.split("\n").slice(0, 6).join("\n") : "";
    const repeatNote = suppressed
        ? `\n\n<i>${suppressed} identical error(s) suppressed in the last ${THROTTLE_WINDOW_MS / 60000} min</i>`
        : "";

    const text =
        `<b>${opts.fatal ? "🔴 FATAL" : "❗️ Backend Error"}</b>\n` +
        `Where: <code>${esc(context)}</code>\n` +
        `Error: <code>${esc(message)}</code>` +
        (stack ? `\n\n<pre>${esc(stack)}</pre>` : "") +
        repeatNote;

    return send(text, "general");
}

module.exports = {
    send,
    notifyGeneralError,
    esc,
    // exported for tests
    MAX_MESSAGE_LEN,
    THROTTLE_WINDOW_MS,
};
