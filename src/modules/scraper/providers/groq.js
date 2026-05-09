const Groq = require("groq-sdk");

const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
let client = null;

function getClient() {
    if (!process.env.GROQ_API_KEY) {
        throw new Error("[Groq] GROQ_API_KEY environment variable is not set");
    }
    if (!client) {
        client = new Groq({ apiKey: process.env.GROQ_API_KEY });
    }
    return client;
}

module.exports = {
    name: "groq",

    async complete(systemPrompt, userMessage) {
        try {
            const response = await getClient().chat.completions.create({
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
