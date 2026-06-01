/**
 * Heuristic company-name matching.
 *
 * Different job sources spell the same company differently:
 *   "Adani Group", "Adani", "Ada"
 *   "ABC Private Limited", "ABC Pvt. Ltd.", "ABC"
 * These must resolve to ONE company instead of spawning duplicates.
 *
 * Strategy (pure string logic, no DB):
 *   1. normalizeCompanyName() → a canonical key: lowercased, de-punctuated,
 *      diacritics stripped, legal/group suffixes ("Pvt Ltd", "Group", ...)
 *      removed. So "ABC Private Limited" and "ABC" collapse to "abc";
 *      "Adani Group" and "Adani" collapse to "adani".
 *   2. keysMatch() compares two canonical keys with:
 *        - exact equality
 *        - prefix containment (handles truncations like "ada" ⊂ "adani")
 *        - Dice-coefficient similarity (handles typos / minor variants)
 */

// Trailing tokens that don't distinguish a company. Conservative on purpose:
// only legal forms + "group/holdings", NOT descriptors like "technologies"
// or "solutions" (those legitimately separate real companies).
const SUFFIX_TOKENS = new Set([
    "pvt", "private", "ltd", "limited", "llp", "llc", "plc",
    "inc", "incorporated", "corp", "corporation", "co", "company",
    "gmbh", "ag", "sa", "nv", "bv", "pte", "pty", "spa", "srl",
    "group", "holding", "holdings",
]);

/**
 * Reduce a raw company name to a canonical comparison key.
 * Returns "" when nothing meaningful remains.
 */
function normalizeCompanyName(raw) {
    if (raw === null || raw === undefined) return "";
    let s = String(raw).toLowerCase();
    // Strip diacritics (e.g. "Nestlé" → "nestle").
    s = s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
    // "&" reads as "and".
    s = s.replace(/&/g, " and ");
    // Everything non-alphanumeric becomes a separator.
    s = s.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
    if (!s) return "";

    let tokens = s.split(" ");
    // Drop a leading article.
    if (tokens.length > 1 && tokens[0] === "the") tokens = tokens.slice(1);
    // Peel trailing suffix tokens repeatedly ("ABC Pvt Ltd" → "abc").
    while (tokens.length > 1 && SUFFIX_TOKENS.has(tokens[tokens.length - 1])) {
        tokens.pop();
    }
    return tokens.join(" ");
}

/** Dice coefficient over character bigrams → 0..1 similarity. */
function diceCoefficient(a, b) {
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    const bigrams = new Map();
    for (let i = 0; i < a.length - 1; i++) {
        const bg = a.slice(i, i + 2);
        bigrams.set(bg, (bigrams.get(bg) || 0) + 1);
    }
    let intersection = 0;
    for (let i = 0; i < b.length - 1; i++) {
        const bg = b.slice(i, i + 2);
        const count = bigrams.get(bg) || 0;
        if (count > 0) {
            bigrams.set(bg, count - 1);
            intersection++;
        }
    }
    return (2 * intersection) / (a.length - 1 + (b.length - 1));
}

const PREFIX_MIN_LEN = 3; // "ada" allowed, "ab" not — too ambiguous.
const PREFIX_LEN_RATIO = 0.5; // shorter must be ≥50% of longer.
const SIMILARITY_THRESHOLD = 0.8; // typo tolerance (~1 char off in a short name).

/**
 * Do two canonical keys denote the same company?
 */
function keysMatch(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;

    const [short, long] = a.length <= b.length ? [a, b] : [b, a];

    // Truncation: "ada" is a prefix of "adani". Guarded so short, unrelated
    // fragments don't collide and the lengths stay comparable.
    if (
        short.length >= PREFIX_MIN_LEN &&
        long.startsWith(short) &&
        short.length / long.length >= PREFIX_LEN_RATIO
    ) {
        return true;
    }

    return diceCoefficient(a, b) >= SIMILARITY_THRESHOLD;
}

/**
 * Convenience: do two raw company names match heuristically?
 */
function companyNamesMatch(a, b) {
    return keysMatch(normalizeCompanyName(a), normalizeCompanyName(b));
}

module.exports = {
    normalizeCompanyName,
    keysMatch,
    companyNamesMatch,
    diceCoefficient,
};
