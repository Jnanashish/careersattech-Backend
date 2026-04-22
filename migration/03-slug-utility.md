# 03 — Slug Utility

## File

- [utils/slugify.js](../utils/slugify.js) — CommonJS module at the repo root
  under a new `utils/` directory.

### Folder-placement note

The audit report (§1) establishes the repo has **no `src/` directory** and
that feature/utility folders live at the repo root (e.g., `Helpers/`,
`config/`, `middleware/`). Creating `src/utils/` would violate that
convention, so the utility lives at `utils/slugify.js` — a new top-level
folder that matches the repo's flat, root-scoped layout and the task's
"conventional utilities folder" intent.

## Dependencies

- `slugify@^1.6.9` — npm package (installed in prompt 2).
- `nanoid@^5.1.9` — npm package (installed in prompt 2). Node 22.12+ (the
  project pins `engines.node: ">=18"`; `node -v` in this environment
  reports `v22.18.0`) supports synchronous `require()` of ESM modules, so
  `require("nanoid")` works without dynamic `import()`.

## Function signatures

```js
// utils/slugify.js
module.exports = {
    generateJobSlug,     // (companyName: string, title: string) => string
    generateCompanySlug, // (companyName: string) => string
    validateSlug,        // (slug: string) => { valid: boolean, error: string | null }
};
```

### `generateJobSlug(companyName, title)`

- Slugifies both inputs with `{ lower: true, strict: true, trim: true }`.
- Joins as `"{companySlug}-{titleSlug}"`, caps the base at **70 characters**
  (trailing hyphens stripped after truncation).
- Appends `"-{6charRandom}"` where the suffix is a nanoid generated from
  the custom alphabet `"23456789abcdefghjkmnpqrstuvwxyz"` (length 6 —
  excludes `0`, `1`, `O`, `l`, `I`).
- Throws `Error` if either argument is missing, not a string, empty, or
  slugifies to an empty string.

Sample outputs (from the self-test):

| Input | Output |
|---|---|
| `("Stripe", "Frontend Engineer")` | `stripe-frontend-engineer-fj3gaq` |
| `("Procter & Gamble", "Data/ML Engineer (Remote)")` | `procter-and-gamble-dataml-engineer-remote-q8vqwx` |
| `("Google", "Senior Staff Principal Distinguished Backend Platform Reliability Engineer II")` | `google-senior-staff-principal-distinguished-backend-platform-reliabili-bb89aq` (77 chars total; base capped at 70) |

### `generateCompanySlug(companyName)`

- Slugifies with the same options, no random suffix.
- Throws `Error` if missing/empty or if the slug normalizes to empty.

Sample outputs:

| Input | Output |
|---|---|
| `"Stripe"` | `stripe` |
| `"Procter & Gamble Co."` | `procter-and-gamble-co` |
| `"Some Exceptionally Long Company Legal Entity Name LLC International Holdings"` | `some-exceptionally-long-company-legal-entity-name-llc-international-holdings` |

### `validateSlug(slug)`

- Returns `{ valid: boolean, error: string | null }`.
- Valid when: non-empty string, length ≤ 100, matches
  `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`.
- Error messages:
  - `null` / `undefined` / empty / non-string → `"Slug is required"`
  - length > 100 → `"Slug cannot exceed 100 characters"`
  - invalid chars (uppercase, spaces, leading/trailing/consecutive hyphens)
    → `"Slug must contain only lowercase letters, numbers, and hyphens (no leading/trailing/consecutive hyphens)"`

## Self-test

- Script: [migration/scripts/test-slugify.js](./scripts/test-slugify.js)
- Run: `node ./migration/scripts/test-slugify.js`

### Full output

```
------------------------------------------------------------------------------------------------------------------------
STATUS  TEST                                                                              DETAIL
------------------------------------------------------------------------------------------------------------------------
PASS    generateJobSlug: normal ('Stripe', 'Frontend Engineer')                           stripe-frontend-engineer-fj3gaq
PASS    generateJobSlug: special chars ('Procter & Gamble', 'Data/ML Engineer (Remote)')  procter-and-gamble-dataml-engineer-remote-q8vqwx
PASS    generateJobSlug: long title capped at 70 chars                                    google-senior-staff-principal-distinguished-backend-platform-reliabili-bb89aq (len=77)
PASS    generateJobSlug: empty companyName throws                                         generateJobSlug: companyName is required and must be a non-empty string
PASS    generateJobSlug: empty title throws                                               generateJobSlug: title is required and must be a non-empty string
PASS    generateJobSlug: 5 invocations produce 5 unique slugs                             unique=5; samples=[stripe-frontend-engineer-7a6sze, stripe-frontend-engineer-jcqnx3, stripe-frontend-engineer-f8exj6, stripe-frontend-engineer-evdj52, stripe-frontend-engineer-j4ebqe]
PASS    generateCompanySlug: normal ('Stripe')                                            stripe
PASS    generateCompanySlug: special chars ('Procter & Gamble Co.')                       procter-and-gamble-co
PASS    generateCompanySlug: long name produces valid slug                                some-exceptionally-long-company-legal-entity-name-llc-international-holdings (len=76)
PASS    generateCompanySlug: empty throws                                                 generateCompanySlug: companyName is required and must be a non-empty string
PASS    validateSlug: valid slug                                                          input="stripe-frontend-engineer-a8b3c2" → {"valid":true,"error":null}
PASS    validateSlug: empty string                                                        input="" → {"valid":false,"error":"Slug is required"}
PASS    validateSlug: too long (>100 chars)                                               input="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa → {"valid":false,"error":"Slug cannot exceed 100 characters"}
PASS    validateSlug: contains spaces                                                     input="stripe frontend engineer" → {"valid":false,"error":"Slug must contain only lowercase letters, numbers, and hyphens (no leading/trailing/consecutive hyphens)"}
PASS    validateSlug: contains uppercase                                                  input="Stripe-Frontend" → {"valid":false,"error":"Slug must contain only lowercase letters, numbers, and hyphens (no leading/trailing/consecutive hyphens)"}
PASS    validateSlug: consecutive hyphens                                                 input="stripe--frontend" → {"valid":false,"error":"Slug must contain only lowercase letters, numbers, and hyphens (no leading/trailing/consecutive hyphens)"}
------------------------------------------------------------------------------------------------------------------------
TOTAL: 16  PASSED: 16  FAILED: 0
```

Exit code: `0`.
