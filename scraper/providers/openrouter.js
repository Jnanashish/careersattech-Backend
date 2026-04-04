const axios = require("axios");

const MODEL = process.env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free";

module.exports = {
    name: "openrouter",

    async complete(systemPrompt, userMessage) {
        if (!process.env.OPENROUTER_API_KEY) {
            throw new Error("[OpenRouter] OPENROUTER_API_KEY environment variable is not set");
        }
        try {
            const response = await axios.post(
                "https://openrouter.ai/api/v1/chat/completions",
                {
                    model: MODEL,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userMessage },
                    ],
                    temperature: 0.3,
                },
                {
                    headers: {
                        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
                        "Content-Type": "application/json",
                    },
                }
            );
            return response.data.choices[0].message.content;
        } catch (err) {
            const msg = err.response?.data?.error?.message || err.message;
            throw new Error(`[OpenRouter] API error: ${msg}`);
        }
    },
};
