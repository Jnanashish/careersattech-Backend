# 02 — V2 Models Created

## Files created

- [model/jobV2.schema.js](../model/jobV2.schema.js) — `JobV2` model, collection `jobs_v2`
- [model/companyV2.schema.js](../model/companyV2.schema.js) — `CompanyV2` model, collection `companies_v2`

Both registered via the guarded pattern from the reference schemas:
`module.exports = mongoose.models.X || mongoose.model("X", schema, "<collection>")`.

## Packages installed

```
npm install slugify nanoid
```

Both were absent from `package.json` per audit report §2 and are now added as
runtime dependencies.

## Verification

Command run from the repo root:

```
node -e "require('./model/jobV2.schema'); require('./model/companyV2.schema'); console.log('OK');"
```

Output:

```
OK
```

## Deviations from audit report conventions

None.

Notes on the registration pattern — the audit report (§4) documents existing
models using the **two-arg** form `mongoose.model(name, schema)` which relies
on Mongoose's pluralizer for the collection name. The V2 reference schemas
explicitly require:

1. Custom collection names (`jobs_v2`, `companies_v2`) that Mongoose's
   pluralizer would not produce from `JobV2` / `CompanyV2`, so the
   **three-arg** form `mongoose.model(name, schema, collection)` is used.
2. The `mongoose.models.X || mongoose.model(...)` guard against
   `OverwriteModelError` on hot-reload / repeated requires.

Both are specified verbatim in the reference schema text and were applied
as-is. No field names, enums, validators, or indexes were modified.
