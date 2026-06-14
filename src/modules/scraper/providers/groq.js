const Groq = require("groq-sdk");
const config = require("../../../config");

const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

// Round-robin across the configured Groq API keys so each request hits a
// different account — spreads load instead of spiking one key's rate limit.
// One client per key, created lazily and cached. The transformer retries on
// failure, and because the cursor advances every call, a rate-limited key
// naturally fails over to the next key on the retry.
const clients = new Map();
let rrCursor = 0;

function getKeys() {
    const keys = config.ai.groqKeys;
    if (!keys || keys.length === 0) {
        throw new Error(
            "[Groq] No Groq API key set (GROQ_API_KEY_1 / GROQ_API_KEY_2 / GROQ_API_KEY)"
        );
    }
    return keys;
}

function nextClient() {
    const keys = getKeys();
    const key = keys[rrCursor++ % keys.length];
    let client = clients.get(key);
    if (!client) {
        client = new Groq({ apiKey: key });
        clients.set(key, client);
    }
    return client;
}

module.exports = {
    name: "groq",

    async complete(systemPrompt, userMessage) {
        try {
            const response = await nextClient().chat.completions.create({
                model: MODEL,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userMessage },
                ],
                temperature: 0.3,
            });
            return response.choices[0].message.content;
        } catch (err) {
            throw new Error(`[Groq] API error: ${err.message}`);
        }
    },
};
