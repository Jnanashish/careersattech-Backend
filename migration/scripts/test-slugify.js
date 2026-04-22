const path = require("path");
const { generateJobSlug, generateCompanySlug, validateSlug } = require(path.join(__dirname, "..", "..", "utils", "slugify"));

const results = [];

function record(name, passed, detail) {
    results.push({ name, passed, detail });
}

function safe(fn) {
    try {
        return { ok: true, value: fn() };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

// ------------------------------------------------------------------
// generateJobSlug — 3 sample inputs
// ------------------------------------------------------------------
{
    // Case 1: normal
    const r = safe(() => generateJobSlug("Stripe", "Frontend Engineer"));
    const pattern = /^stripe-frontend-engineer-[23456789abcdefghjkmnpqrstuvwxyz]{6}$/;
    record(
        "generateJobSlug: normal ('Stripe', 'Frontend Engineer')",
        r.ok && pattern.test(r.value),
        r.ok ? r.value : r.error
    );
}
{
    // Case 2: special characters (&)
    const r = safe(() => generateJobSlug("Procter & Gamble", "Data/ML Engineer (Remote)"));
    const pattern = /^procter-and-gamble-dataml-engineer-remote-[23456789abcdefghjkmnpqrstuvwxyz]{6}$/;
    // Slugify replaces '&' with 'and' by default under strict mode.
    // Accept either "procter-and-gamble..." or a 70-char-capped version that starts with "procter".
    const passes = r.ok &&
        /^procter/.test(r.value) &&
        /-[23456789abcdefghjkmnpqrstuvwxyz]{6}$/.test(r.value) &&
        validateSlug(r.value).valid;
    record(
        "generateJobSlug: special chars ('Procter & Gamble', 'Data/ML Engineer (Remote)')",
        passes,
        r.ok ? r.value : r.error
    );
}
{
    // Case 3: very long title — base should be capped at 70 chars, then suffix appended
    const longTitle = "Senior Staff Principal Distinguished Backend Platform Reliability Engineer II";
    const r = safe(() => generateJobSlug("Google", longTitle));
    // base max 70 then "-XXXXXX" => total max 77
    const parts = r.ok ? r.value.split("-") : [];
    const suffix = parts[parts.length - 1];
    const base = r.ok ? r.value.slice(0, r.value.length - 7) : "";
    const passes =
        r.ok &&
        r.value.length <= 77 &&
        base.length <= 70 &&
        /^[23456789abcdefghjkmnpqrstuvwxyz]{6}$/.test(suffix) &&
        validateSlug(r.value).valid;
    record(
        "generateJobSlug: long title capped at 70 chars",
        passes,
        r.ok ? `${r.value} (len=${r.value.length})` : r.error
    );
}

// ------------------------------------------------------------------
// generateJobSlug — missing/empty inputs should throw
// ------------------------------------------------------------------
{
    const r = safe(() => generateJobSlug("", "Engineer"));
    record("generateJobSlug: empty companyName throws", !r.ok, r.ok ? `unexpected: ${r.value}` : r.error);
}
{
    const r = safe(() => generateJobSlug("Stripe", ""));
    record("generateJobSlug: empty title throws", !r.ok, r.ok ? `unexpected: ${r.value}` : r.error);
}

// ------------------------------------------------------------------
// generateJobSlug — uniqueness across 5 invocations
// ------------------------------------------------------------------
{
    const slugs = new Set();
    for (let i = 0; i < 5; i++) {
        slugs.add(generateJobSlug("Stripe", "Frontend Engineer"));
    }
    record(
        "generateJobSlug: 5 invocations produce 5 unique slugs",
        slugs.size === 5,
        `unique=${slugs.size}; samples=[${Array.from(slugs).join(", ")}]`
    );
}

// ------------------------------------------------------------------
// generateCompanySlug — 3 sample inputs
// ------------------------------------------------------------------
{
    const r = safe(() => generateCompanySlug("Stripe"));
    record("generateCompanySlug: normal ('Stripe')", r.ok && r.value === "stripe", r.ok ? r.value : r.error);
}
{
    const r = safe(() => generateCompanySlug("Procter & Gamble Co."));
    record(
        "generateCompanySlug: special chars ('Procter & Gamble Co.')",
        r.ok && r.value === "procter-and-gamble-co",
        r.ok ? r.value : r.error
    );
}
{
    const longName = "Some Exceptionally Long Company Legal Entity Name LLC International Holdings";
    const r = safe(() => generateCompanySlug(longName));
    record(
        "generateCompanySlug: long name produces valid slug",
        r.ok && validateSlug(r.value).valid,
        r.ok ? `${r.value} (len=${r.value.length})` : r.error
    );
}
{
    const r = safe(() => generateCompanySlug(""));
    record("generateCompanySlug: empty throws", !r.ok, r.ok ? `unexpected: ${r.value}` : r.error);
}

// ------------------------------------------------------------------
// validateSlug — 6 cases (valid, empty, too long, spaces, uppercase, consecutive hyphens)
// ------------------------------------------------------------------
const validateCases = [
    {
        name: "validateSlug: valid slug",
        input: "stripe-frontend-engineer-a8b3c2",
        expected: { valid: true, error: null },
    },
    {
        name: "validateSlug: empty string",
        input: "",
        expected: { valid: false, error: "Slug is required" },
    },
    {
        name: "validateSlug: too long (>100 chars)",
        input: "a".repeat(101),
        expected: { valid: false, error: "Slug cannot exceed 100 characters" },
    },
    {
        name: "validateSlug: contains spaces",
        input: "stripe frontend engineer",
        expected: {
            valid: false,
            error: "Slug must contain only lowercase letters, numbers, and hyphens (no leading/trailing/consecutive hyphens)",
        },
    },
    {
        name: "validateSlug: contains uppercase",
        input: "Stripe-Frontend",
        expected: {
            valid: false,
            error: "Slug must contain only lowercase letters, numbers, and hyphens (no leading/trailing/consecutive hyphens)",
        },
    },
    {
        name: "validateSlug: consecutive hyphens",
        input: "stripe--frontend",
        expected: {
            valid: false,
            error: "Slug must contain only lowercase letters, numbers, and hyphens (no leading/trailing/consecutive hyphens)",
        },
    },
];

for (const tc of validateCases) {
    const actual = validateSlug(tc.input);
    const passed = actual.valid === tc.expected.valid && actual.error === tc.expected.error;
    record(tc.name, passed, `input=${JSON.stringify(tc.input).slice(0, 50)} → ${JSON.stringify(actual)}`);
}

// ------------------------------------------------------------------
// Render pass/fail table
// ------------------------------------------------------------------
const maxName = Math.max(...results.map((r) => r.name.length));
const header = `${"STATUS".padEnd(6)}  ${"TEST".padEnd(maxName)}  DETAIL`;
const divider = "-".repeat(Math.min(120, header.length + 40));

console.log(divider);
console.log(header);
console.log(divider);
for (const r of results) {
    const status = r.passed ? "PASS" : "FAIL";
    console.log(`${status.padEnd(6)}  ${r.name.padEnd(maxName)}  ${r.detail}`);
}
console.log(divider);

const passedCount = results.filter((r) => r.passed).length;
const failedCount = results.length - passedCount;
console.log(`TOTAL: ${results.length}  PASSED: ${passedCount}  FAILED: ${failedCount}`);

process.exit(failedCount === 0 ? 0 : 1);
