const Groq = require("groq-sdk");
const config = require("../../../config");

const MODEL = config.ai.groqModel;

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
                // Groq meters tokens-per-minute across the whole organization,
                // and the free tier gives this model 8000 — small enough that a
                // single oversized prompt exceeds the entire minute's budget and
                // 413s before a token is generated. Left unbounded, a run's
                // spend against that budget is also unknowable in advance,
                // because the model's default output ceiling is 65K.
                //
                // Capping it makes each call's worst case a fixed number. The
                // transformer's JSON — a 400-800 word HTML description plus a
                // 240-340 word company overview — lands near 2200 tokens, so
                // 4000 is roughly 2x headroom: high enough that a long posting
                // is not truncated into invalid JSON, low enough to stay well
                // inside the cap alongside the prompt.
                max_tokens: 4000,
            });
            return response.choices[0].message.content;
        } catch (err) {
            throw new Error(`[Groq] API error: ${err.message}`);
        }
    },
};
