const providers = {
    // gemini: disabled for now — scraping runs on Groq only.
    // Code is kept in ./gemini.js (untouched). To re-enable, uncomment this
    // line and set AI_PROVIDER=gemini.
    // gemini: () => require("./gemini"),
    claude: () => require("./claude"),
    groq: () => require("./groq"),
    openrouter: () => require("./openrouter"),
};

function getProvider() {
    const name = process.env.AI_PROVIDER || "groq";
    if (!providers[name]) {
        throw new Error(
            `Unknown AI_PROVIDER: "${name}". Available: ${Object.keys(providers).join(", ")}`
        );
    }
    return providers[name]();
}

module.exports = { getProvider };
