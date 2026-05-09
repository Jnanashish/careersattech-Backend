const { GoogleGenerativeAI } = require("@google/generative-ai");

const MODEL = "gemini-2.0-flash";
let client = null;

function getClient() {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("[Gemini] GEMINI_API_KEY environment variable is not set");
    }
    if (!client) {
        client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    }
    return client;
}

module.exports = {
    name: "gemini",

    async complete(systemPrompt, userMessage) {
        try {
            const model = getClient().getGenerativeModel({
                model: MODEL,
                systemInstruction: systemPrompt,
            });
            const result = await model.generateContent(userMessage);
            const text = result.response.text();
            return text;
        } catch (err) {
            throw new Error(`[Gemini] API error: ${err.message}`);
        }
    },
};
