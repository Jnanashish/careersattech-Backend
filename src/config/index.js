const dotenv = require("dotenv");
dotenv.config();

const REQUIRED = [
    "DATABASE",
    "CLOUD_NAME",
    "API_KEY",
    "API_SECRET",
    "FIREBASE_PROJECT_ID",
    "FIREBASE_PRIVATE_KEY",
    "FIREBASE_CLIENT_EMAIL",
    "CLICK_HASH_PEPPER",
];

for (const key of REQUIRED) {
    if (!process.env[key]) {
        console.error(`FATAL: Missing required environment variable: ${key}`);
        process.exit(1);
    }
}

const env = process.env;

const trustProxy = (() => {
    const v = env.TRUST_PROXY;
    if (v === undefined || v === "") return 1;
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
})();

const allowedOrigins = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

// One bot posts to all three channels; only the chat ID differs. Numeric
// channel IDs are negative and start with -100. Read them with:
//   curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates"
// after adding the bot as an admin and posting once in each channel.
//
// An empty value disables that channel: utils/telegram logs which one and skips
// it, rather than burning retries on a chat ID Telegram will reject.
const TELEGRAM_CHANNELS = Object.freeze({
    // Anything the scrape pipeline failed at.
    scraperErrorsChatId: "-1004451592561",
    // Important backend errors only — 500s and process-level crashes.
    generalErrorsChatId: "-1004312539475",
    // The published-job list for each run.
    jobsChatId: "-1004417232066",
});

const config = Object.freeze({
    server: Object.freeze({
        port: Number(env.PORT) || 5002,
        env: env.NODE_ENV || "development",
        isProd: env.NODE_ENV === "production",
        trustProxy,
        allowedOrigins,
    }),
    db: Object.freeze({
        uri: env.DATABASE,
    }),
    firebase: Object.freeze({
        projectId: env.FIREBASE_PROJECT_ID,
        privateKeyId: env.FIREBASE_PRIVATE_KEY_ID,
        privateKey: env.FIREBASE_PRIVATE_KEY ? env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n") : undefined,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        clientId: env.FIREBASE_CLIENT_ID,
        requireAdminClaim: env.FIREBASE_REQUIRE_ADMIN_CLAIM === "true",
    }),
    cloudinary: Object.freeze({
        cloudName: env.CLOUD_NAME,
        apiKey: env.API_KEY,
        apiSecret: env.API_SECRET,
    }),
    cloudinaryAds: Object.freeze({
        cloudName: env.CLOUD_NAME2,
        apiKey: env.API_KEY2,
        apiSecret: env.API_SECRET2,
    }),
    auth: Object.freeze({
        adminApiKey: env.ADMIN_API_KEY,
        adminSecret: env.ADMIN_SECRET,
    }),
    security: Object.freeze({
        clickHashPepper: env.CLICK_HASH_PEPPER,
    }),
    ai: Object.freeze({
        provider: env.AI_PROVIDER || "groq",
        geminiKey: env.GEMINI_API_KEY,
        // Round-robin pool: requests rotate across these three Groq keys so
        // load spreads over all three accounts instead of spiking one key's
        // rate limit. Groq meters per organization, so three separate accounts
        // give three separate TPM/TPD budgets. Deduped, so a key repeated
        // across vars is only pooled once.
        groqKeys: Object.freeze([
            ...new Set(
                [env.GROQ_API_KEY_1, env.GROQ_API_KEY_2, env.GROQ_API_KEY]
                    .map((k) => (typeof k === "string" ? k.trim() : ""))
                    .filter(Boolean)
            ),
        ]),
        // Pinned in code, not env. llama-3.3-70b-versatile is still a
        // Production model at Groq but is no longer callable on the free tier,
        // so it 404s with "does not exist or you do not have access to it".
        // gpt-oss-120b is the largest model the free tier can reach
        // (131K context, 65K max output).
        groqModel: "openai/gpt-oss-120b",
        claudeKey: env.CLAUDE_API_KEY,
        claudeModel: env.CLAUDE_MODEL,
        openrouterKey: env.OPENROUTER_API_KEY,
        openrouterModel: env.OPENROUTER_MODEL,
    }),
    scraper: Object.freeze({
        scraperApiKeys: Object.freeze(
            [env.SCRAPERAPI_KEY_1, env.SCRAPERAPI_KEY_2, env.SCRAPERAPI_KEY_3]
                .map((k) => (typeof k === "string" ? k.trim() : ""))
                .filter(Boolean)
        ),
    }),
    telegram: Object.freeze({
        // The bot token is the only credential here and stays in env. The chat
        // IDs are fixed properties of this deployment, not secrets — holding
        // one grants nothing without the token plus admin rights on the
        // channel — so they are pinned in code instead.
        botToken: env.TELEGRAM_BOT_TOKEN,
        ...TELEGRAM_CHANNELS,
    }),
    blog: Object.freeze({
        cloudinaryFolder: env.BLOG_CLOUDINARY_FOLDER || "blog",
        revalidationUrl: env.NEXT_REVALIDATION_URL || env.SITE_REVALIDATE_URL,
        revalidateSecret: env.REVALIDATE_SECRET,
        siteUrl: env.SITE_URL,
        siteTitle: env.SITE_TITLE,
        siteDescription: env.SITE_DESCRIPTION,
    }),
});

if (!config.server.allowedOrigins.length) {
    console.warn("WARNING: ALLOWED_ORIGINS not set — CORS will only allow built-in defaults");
}

module.exports = config;
