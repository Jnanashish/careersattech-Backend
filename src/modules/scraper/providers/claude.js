const Anthropic = require("@anthropic-ai/sdk");

const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";
let client = null;

function getClient() {
    if (!process.env.CLAUDE_API_KEY) {
        throw new Error("[Claude] CLAUDE_API_KEY environment variable is not set");
    }
    if (!client) {
        client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    }
    return client;
}

module.exports = {
    name: "claude",

    async complete(systemPrompt, userMessage) {
        try {
            const response = await getClient().messages.create({
                model: MODEL,
                max_tokens: 2048,
                system: systemPrompt,
                messages: [{ role: "user", content: userMessage }],
            });
            return response.content[0].text;
        } catch (err) {
            throw new Error(`[Claude] API error: ${err.message}`);
        }
    },
};
