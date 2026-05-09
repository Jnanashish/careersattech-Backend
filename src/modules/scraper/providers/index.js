const providers = {
    gemini: () => require("./gemini"),
    claude: () => require("./claude"),
    groq: () => require("./groq"),
    openrouter: () => require("./openrouter"),
};

function getProvider() {
    const name = process.env.AI_PROVIDER || "gemini";
    if (!providers[name]) {
        throw new Error(
            `Unknown AI_PROVIDER: "${name}". Available: ${Object.keys(providers).join(", ")}`
        );
    }
    return providers[name]();
}

module.exports = { getProvider };
