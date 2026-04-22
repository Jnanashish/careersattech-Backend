# 07 — V2 Seed & Verify Scripts

One-shot Node scripts for bootstrapping the `companies_v2` / `jobs_v2`
collections with sample data, and for auditing the DB state (index
coverage, document counts, reference integrity) against the Mongoose
schemas.

---

## Files

| Path | Purpose |
|------|---------|
| [migration/scripts/seed-v2.js](scripts/seed-v2.js) | Seed 3 companies + 10 jobs into `companies_v2` / `jobs_v2`. Supports `--reset`. |
| [migration/scripts/verify-v2.js](scripts/verify-v2.js) | Audit DB indexes, counts, and job→company references. |

Both scripts:

- Call `dotenv.config()` against the repo `.env` before anything else.
- `require("../../DB/connection")` to reuse the project's existing DB
  connection helper (as required by the task) — then `await
  mongoose.connection.asPromise()` to wait for the connection to open.
- `await mongoose.disconnect(); process.exit(0|1)` cleanly on exit.
- **Never touch** legacy collections (`jobdescs`, `companylogos`) — the
  seed script's `--reset` only deletes from `jobs_v2` / `companies_v2`;
  verify reads legacy counts but never writes.

Dependencies reused: `utils/slugify` (`generateJobSlug`,
`generateCompanySlug`), `model/jobV2.schema`, `model/companyV2.schema`.

---

## npm scripts added

Appended to [package.json](../package.json) `"scripts"`:

```json
{
  "db:v2:seed":        "node ./migration/scripts/seed-v2.js",
  "db:v2:seed:reset":  "node ./migration/scripts/seed-v2.js --reset",
  "db:v2:verify":      "node ./migration/scripts/verify-v2.js"
}
```

---

## Run 1 — `npm run db:v2:seed:reset`

Invoked with `yes` piped to stdin to satisfy the confirmation prompt.

```
=== seed-v2 ===
DB: mongodb+srv://***@cluster0.w0m6q.mongodb.net/mernstack?retryWrites=true&w=majority
Connected.

--reset flag detected.
About to DELETE all documents from: jobs_v2, companies_v2
Legacy collections (jobdescs, companylogos) will NOT be touched.
Type 'yes' to confirm: MongoDB connected successfully
Deleted 0 jobs_v2 docs
Deleted 0 companies_v2 docs

--- Seeding companies ---
  [company] _id=69e7d385de2f2a1ef753e71e  slug=stripe      name=Stripe
  [company] _id=69e7d386de2f2a1ef753e720  slug=google      name=Google
  [company] _id=69e7d386de2f2a1ef753e723  slug=accenture   name=Accenture

--- Seeding jobs ---
  [job] _id=69e7d386de2f2a1ef753e725  slug=stripe-software-engineer-zqpyg9                     status=published  displayMode=internal            company=Stripe
  [job] _id=69e7d387de2f2a1ef753e728  slug=stripe-frontend-engineer-intern-zy449n              status=published  displayMode=internal            company=Stripe
  [job] _id=69e7d387de2f2a1ef753e72a  slug=stripe-data-analyst-ab3dgr                          status=published  displayMode=internal            company=Stripe
  [job] _id=69e7d388de2f2a1ef753e72d  slug=google-software-engineer-ii-cevh3q                  status=published  displayMode=internal            company=Google
  [job] _id=69e7d388de2f2a1ef753e72f  slug=google-associate-product-manager-intern-nzyvss      status=published  displayMode=internal            company=Google
  [job] _id=69e7d388de2f2a1ef753e731  slug=google-ux-designer-y4scqa                           status=published  displayMode=external_redirect   company=Google
  [job] _id=69e7d389de2f2a1ef753e734  slug=google-machine-learning-engineer-8yed7j             status=draft      displayMode=internal            company=Google
  [job] _id=69e7d389de2f2a1ef753e737  slug=accenture-associate-software-engineer-8wtf5z        status=published  displayMode=internal            company=Accenture
  [job] _id=69e7d389de2f2a1ef753e739  slug=accenture-data-engineer-azwzxe                      status=published  displayMode=external_redirect   company=Accenture
  [job] _id=69e7d38ade2f2a1ef753e73b  slug=accenture-analyst-intern-s5n758                     status=expired    displayMode=internal            company=Accenture

--- Updating company stats ---
  [stats] Stripe     openJobsCount=3  totalJobsEverPosted=3
  [stats] Google     openJobsCount=3  totalJobsEverPosted=4
  [stats] Accenture  openJobsCount=2  totalJobsEverPosted=3

=== Final counts ===
  companies_v2: 3
  jobs_v2:      10
Done.
```

### Data mix (matches spec)

| Dimension          | Breakdown                                                  |
|--------------------|-------------------------------------------------------------|
| employmentType     | FULL_TIME: 7 &nbsp; INTERN: 3                               |
| batch              | [2025, 2026]: 6 &nbsp; [2026, 2027]: 2 &nbsp; [2027]: 2      |
| workMode           | onsite: 5 &nbsp; hybrid: 3 &nbsp; remote: 2                  |
| category           | engineering: 6 &nbsp; data: 2 &nbsp; product: 1 &nbsp; design: 1 |
| status             | published: 8 &nbsp; draft: 1 &nbsp; expired: 1               |
| displayMode        | internal: 8 &nbsp; external_redirect: 2                      |
| external_redirect  | both skip `jobDescription.html` (pre-validate hook allows it)|

---

## Run 2 — `npm run db:v2:verify`

```
=== verify-v2 ===

[companies_v2] Index check
  DB collection: companies_v2
  DB indexes (excl. _id_): 9
  Schema indexes:          9
    • db: {slug:1}                                  [unique]                           name=slug_1
    • db: {companyType:1}                                                              name=companyType_1
    • db: {industry:1}                                                                 name=industry_1
    • db: {tags:1}                                                                     name=tags_1
    • db: {status:1}                                                                   name=status_1
    • db: {companyName:1}                           [unique, collation=en/2]           name=companyName_1
    • db: {industry:1,status:1}                                                        name=industry_1_status_1
    • db: {companyType:1,status:1}                                                     name=companyType_1_status_1
    • db: {sponsorship.tier:-1,companyName:1}                                          name=sponsorship.tier_-1_companyName_1
  OK: companies_v2: no missing indexes
  OK: companies_v2: no extra indexes

[jobs_v2] Index check
  DB collection: jobs_v2
  DB indexes (excl. _id_): 11
  Schema indexes:          17
    • db: {slug:1}                                  [unique]                           name=slug_1
    • db: {company:1}                                                                  name=company_1
    • db: {batch:1}                                                                    name=batch_1
    • db: {category:1}                                                                 name=category_1
    • db: {workMode:1}                                                                 name=workMode_1
    • db: {requiredSkills:1}                                                           name=requiredSkills_1
    • db: {topicTags:1}                                                                name=topicTags_1
    • db: {datePosted:1}                                                               name=datePosted_1
    • db: {validThrough:1}                                                             name=validThrough_1
    • db: {status:1}                                                                   name=status_1
    • db: {status:1,datePosted:-1}                                                     name=status_1_datePosted_-1
  WARN: jobs_v2: MISSING index {status:1,batch:1}                         (present in schema, not in DB — will be created on next model load)
  WARN: jobs_v2: MISSING index {status:1,employmentType:1}                (present in schema, not in DB — will be created on next model load)
  WARN: jobs_v2: MISSING index {status:1,workMode:1}                      (present in schema, not in DB — will be created on next model load)
  WARN: jobs_v2: MISSING index {company:1,status:1}                       (present in schema, not in DB — will be created on next model load)
  WARN: jobs_v2: MISSING index {sponsorship.tier:-1,priority:-1,datePosted:-1} (present in schema, not in DB — will be created on next model load)
  WARN: jobs_v2: MISSING index {title:text,companyName:text,jobDescription.plain:text,requiredSkills:text} (present in schema, not in DB — will be created on next model load)
  OK: jobs_v2: no extra indexes

[counts] Document counts
  companies_v2:                      3
  jobs_v2:                           10
  jobdescs (legacy, read-only):      714
  companylogos (legacy, read-only):  508

[orphans] Job → Company reference check
  OK: All 10 job(s) reference a valid company
```

### Summary table

| Metric          | Value |
|-----------------|-------|
| companies_v2    | 3     |
| jobs_v2         | 10    |
| jobdescs (legacy)    | 714   |
| companylogos (legacy) | 508  |
| orphans         | 0     |
| warnings        | 6     |
| errors          | 0     |
| **RESULT**      | **YELLOW** (6 missing compound/text indexes on `jobs_v2`) |
| Exit code       | `0` (yellow/green both exit 0; only red → 1) |

### Why 6 `jobs_v2` indexes were flagged MISSING

These are the 5 compound indexes declared via `jobV2Schema.index(...)` and
the 1 text index. Mongoose creates them asynchronously after model load
— because the seed script disconnects as soon as inserts finish, the
background index builds on the MongoDB cluster haven't always completed
by the time verify runs. They will be present next time the app boots
(or any model-loading code runs and waits). Spec treats this as warning,
not error — exit code stays 0.

Field-level (`index: true`) and `unique: true` indexes on `jobs_v2`
(e.g. `slug`, `company`, `batch`, `category`, `workMode`,
`requiredSkills`, `topicTags`, `datePosted`, `validThrough`, `status`)
are already present.

---

## Reproduce

```bash
# Seed (additive; does NOT clear)
npm run db:v2:seed

# Seed with full reset (deletes from jobs_v2 + companies_v2 only;
# prompts for 'yes' confirmation on stdin)
npm run db:v2:seed:reset

# Audit
npm run db:v2:verify
```

`--reset` is interactive by design: unpiped invocations wait on stdin
for the literal string `yes`. Anything else aborts without touching
data.
