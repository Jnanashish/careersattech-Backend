# 01 — Codebase Audit Report

> Source-of-truth reference for migration prompts 2–8. Read-only snapshot of
> the `careersattech-Backend` repo at the point of migration kickoff.

---

## 1. Project Structure

Source lives at the **repo root** (no `src/` directory). Entry point is
`app.js`. Folder tree, 3 levels deep:

```
careersattech-Backend/
├── app.js                        # Entry point, Express app
├── package.json
├── jest.config.js
├── .env.example
├── API_DOCS.md
├── DB/
│   └── connection.js             # Mongoose connect (singleton via side-effect require)
├── Data/
│   └── companycareerpage.json    # Static list of career page URLs
├── Helpers/
│   └── controllerHelper.js       # apiErrorHandler, jobDetailsHandler, escapeRegex
├── Temp/                         # Legacy ad-system scaffolding (not wired into app)
│   ├── AdLinkImgSchema.js
│   ├── AdLinkSchema.js
│   ├── AdPosterScheme.js
│   ├── ShowAdPopSchema.js
│   ├── adBanner.js  adLink.js  adLinkImg.js  showAdPop.js
│   ├── companyDetails.js  companyLogo.js
│   └── Controllers/
│       ├── adBanner.js  adLink.js  adLinkImg.js  showAdPop.js
├── __tests__/
│   ├── createApp.js              # Test-only app factory (no rate-limit / auth plugins)
│   ├── setup.js                  # mongodb-memory-server bootstrap
│   ├── company.test.js
│   ├── jobs.test.js
│   └── security.test.js
├── blog/                         # Feature-scoped module (routes+controllers+schema co-located)
│   ├── blog.admin.routes.js
│   ├── blog.routes.js
│   ├── blog.controllers.js
│   ├── blog.schema.js
│   ├── blog.service.js
│   ├── blog.validators.js        # Zod schemas + validate middleware
│   ├── blog.scheduler.js
│   ├── cloudinary.service.js
│   └── markdown.service.js
├── config/
│   └── firebase.js               # firebase-admin initializeApp
├── controllers/
│   ├── analytics.controllers.js
│   ├── common.js                 # getPosterLink (Cloudinary ads account)
│   ├── company.controllers.js
│   └── jobs.controllers.js
├── docs/                         # empty
├── middleware/
│   ├── auth.js                   # requireAuth (Firebase + legacy x-api-key)
│   └── validateObjectId.js
├── model/
│   ├── company.schema.js         # CompanyLogo model
│   ├── jobClickEvent.schema.js   # JobClickEvent model
│   └── jobs.schema.js            # Jobdesc model
├── prompts/
│   └── admin-company-panel.md
├── routes/
│   ├── analytics.routes.js
│   ├── company.routes.js
│   └── jobs.routes.js
└── scraper/                      # Feature-scoped (routes+models+adapters co-located)
    ├── admin.routes.js           # Admin-only routes, guarded by x-admin-secret
    ├── scheduler.js
    ├── scraper.js
    ├── ingester.js
    ├── transformer.js
    ├── notifier.js
    ├── stopFlags.js
    ├── test-adapter.js
    ├── test-provider.js
    ├── adapters/
    │   ├── _template.js  freshershunt.js  index.js
    │   ├── offcampusjobs4u.js  onlyfrontendjobs.js
    ├── models/
    │   ├── ScrapeLog.js  StagingJob.js
    └── providers/
        ├── claude.js  gemini.js  groq.js  index.js  openrouter.js
```

### Module system

**CommonJS** (`require` / `module.exports`). Confirmed from:

- [package.json:1-52](../package.json) — no `"type": "module"` field, `"main": "app.js"`.
- [app.js:1-7](../app.js) — `const express = require("express")`.
- [routes/jobs.routes.js:1-2](../routes/jobs.routes.js) — `require("express")`, `module.exports = router`.
- [model/jobs.schema.js:1](../model/jobs.schema.js) — `const mongoose = require("mongoose")`, `module.exports = Jobdesc`.

### Node version

`engines.node` = `">=18"` (see [package.json:5-7](../package.json)).

---

## 2. Dependencies

### `dependencies` (from [package.json:15-44](../package.json))

| Package | Version |
|---|---|
| `@google/generative-ai` | `^0.24.1` |
| `axios` | `^1.14.0` |
| `blurhash` | `^2.0.5` |
| `cheerio` | `^1.2.0` |
| `cloudinary` | `^2.5.1` |
| `cors` | `^2.8.5` |
| `dotenv` | `^16.4.7` |
| `express` | `^4.21.2` |
| `express-fileupload` | `^1.5.1` |
| `express-rate-limit` | `^8.3.2` |
| `firebase-admin` | `^13.7.0` |
| `groq-sdk` | `^1.1.2` |
| `hast-util-to-string` | `^3.0.1` |
| `helmet` | `^8.1.0` |
| `mongoose` | `^8.9.5` |
| `node-cron` | `^4.2.1` |
| `rehype-autolink-headings` | `^7.1.0` |
| `rehype-prism-plus` | `^2.0.2` |
| `rehype-sanitize` | `^6.0.0` |
| `rehype-slug` | `^6.0.0` |
| `rehype-stringify` | `^10.0.1` |
| `remark-parse` | `^11.0.0` |
| `remark-rehype` | `^11.1.2` |
| `sharp` | `^0.34.5` |
| `unified` | `^11.0.5` |
| `unist-util-visit` | `^5.1.0` |
| `uuid` | `^13.0.0` |
| `zod` | `^4.3.6` |

### `devDependencies`

| Package | Version |
|---|---|
| `jest` | `^30.3.0` |
| `mongodb-memory-server` | `^10.4.3` |
| `nodemon` | `^3.1.9` |
| `supertest` | `^7.2.2` |

### `scripts`

```json
{
  "test":  "jest --forceExit --detectOpenHandles",
  "start": "node app.js",
  "dev":   "nodemon app.js"
}
```

### Requested-for-later packages

| Package  | Installed? |
|----------|------------|
| `slugify` | **No** — `blog/blog.service.js` implements its own `slugify()` inline ([blog.service.js:8-16](../blog/blog.service.js)) |
| `nanoid`  | **No** |
| `supertest` | **Yes** — `^7.2.2` (devDependencies) |

---

## 3. Database Connection

Single file: [DB/connection.js](../DB/connection.js). Full contents:

```js
const mongoose = require("mongoose");

const DB = process.env.DATABASE;

if (!DB) {
    console.error("FATAL: DATABASE environment variable is not set");
    process.exit(1);
}

const connectWithRetry = (retries = 5, delay = 3000) => {
    mongoose
        .connect(DB)
        .then(() => {
            console.log("MongoDB connected successfully");
        })
        .catch((err) => {
            console.error(`MongoDB connection error (retries left: ${retries}):`, err.message);
            if (retries > 0) {
                setTimeout(() => connectWithRetry(retries - 1, delay * 2), delay);
            } else {
                console.error("FATAL: Could not connect to MongoDB after multiple retries");
                process.exit(1);
            }
        });
};

connectWithRetry();

mongoose.connection.on("disconnected", () => {
    console.warn("MongoDB disconnected. Attempting reconnect...");
});

mongoose.connection.on("error", (err) => {
    console.error("MongoDB connection error:", err.message);
});
```

### Connection pattern — notes for migration scripts

- **Side-effect require** — `app.js:26` calls `require("./DB/connection")` which
  immediately kicks off `connectWithRetry()`. No function export, no `await`.
- Reads **`process.env.DATABASE`** (not `MONGODB_URI`).
- There is **no exported `connect()` / `disconnect()` helper**. Migration
  scripts that want to reuse the connection pattern should either:
  1. `require` this file and listen to `mongoose.connection.once("open", …)`, or
  2. Create a new `scripts/db.js` that exports an `async connect()` /
     `disconnect()` pair so scripts can cleanly exit after running.
- Exit-on-failure: after 5 retries the process hard-exits with `process.exit(1)`.

---

## 4. Existing Models

Three Mongoose models live in [model/](../model/), plus one in
[blog/blog.schema.js](../blog/blog.schema.js) and two in
[scraper/models/](../scraper/models/).

| File | Model name | Collection |
|------|-----------|------------|
| [model/jobs.schema.js](../model/jobs.schema.js) | `Jobdesc` | default (`jobdescs`) |
| [model/company.schema.js](../model/company.schema.js) | `CompanyLogo` | default (`companylogos`) |
| [model/jobClickEvent.schema.js](../model/jobClickEvent.schema.js) | `JobClickEvent` | default (`jobclickevents`) |
| [blog/blog.schema.js](../blog/blog.schema.js) | `Blog` | default (`blogs`) |
| [scraper/models/StagingJob.js](../scraper/models/StagingJob.js) | `StagingJob` | default |
| [scraper/models/ScrapeLog.js](../scraper/models/ScrapeLog.js) | `ScrapeLog` | default |

### Registration pattern

**Two-arg** `mongoose.model(name, schema)` — collection name is **not**
explicitly passed. Mongoose pluralizes the model name. Example:

```js
// model/jobs.schema.js:104
const Jobdesc = mongoose.model("Jobdesc", jobdetailsSchema);
```

```js
// model/company.schema.js:39
const CompanyLogo = mongoose.model("CompanyLogo", companydetailsSchema);
```

### Full schema — `Jobdesc` ([model/jobs.schema.js](../model/jobs.schema.js))

```js
const mongoose = require("mongoose");

const jobdetailsSchema = new mongoose.Schema(
    {
        title: { type: String, required: true },
        link: { type: String, required: true },
        jdpage: { type: String },
        salary: { type: String },
        batch: { type: String },
        degree: { type: String },
        jobdesc: { type: String },

        eligibility: { type: String },
        experience: { type: String },
        lastdate: { type: String },              // application deadline
        skills: { type: String },                // array of skills tag
        location: { type: String },
        responsibility: { type: String },

        jobtype: { type: String },               // fulltime or intern role
        imagePath: { type: String, default: "none" },  // logo image path
        companytype: { type: String },           // service / product / startup
        totalclick: { type: Number, default: 0 },
        adclick: { type: Number, default: 0 },
        aboutCompany: { type: String },
        role: { type: String },
        jdbanner: { type: String },              // job post banner
        companyName: { type: String },
        platform: { type: String, default: "careerspage" },
        tags: { type: [String], default: [] },
        skilltags: { type: [String], default: [] },
        salaryRange: {
            from: Number,
            to: Number,
        },
        workMode: {
            type: String,
            enum: ["onsite", "hybrid", "remote"],
            default: "onsite",
        },
        isActive: { type: Boolean, default: true },
        jobId: { type: String },                 // id from company careers page
        isFeaturedJob: { type: Boolean, default: false },
        company: { type: mongoose.Schema.Types.ObjectId, ref: "CompanyLogo" },
        benefits: { type: String },
        priority: { type: Number, default: 1, min: 0 },
        expiresAt: { type: Date },
        source: { type: String },
        postedBy: { type: String },
        isVerified: { type: Boolean, default: false },
        stipend: { type: Number },
        category: {
            type: String,
            enum: ["engineering", "design", "product", "data", "devops", "qa", "management", "other"],
        },
    },
    { timestamps: true }
);

jobdetailsSchema.index({ companyName: 1 });
jobdetailsSchema.index({ batch: 1 });
jobdetailsSchema.index({ degree: 1 });
jobdetailsSchema.index({ jobtype: 1 });
jobdetailsSchema.index({ location: 1 });
jobdetailsSchema.index({ isActive: 1 });
jobdetailsSchema.index({ priority: -1, _id: -1 });

const Jobdesc = mongoose.model("Jobdesc", jobdetailsSchema);

module.exports = Jobdesc;
```

Notes: `timestamps: true` → `createdAt`/`updatedAt`. No `slug` field today.

### Full schema — `CompanyLogo` ([model/company.schema.js](../model/company.schema.js))

```js
const mongoose = require("mongoose");

const companydetailsSchema = new mongoose.Schema({
    companyName: { type: String, required: true },
    smallLogo: { type: String },                     // icon
    largeLogo: { type: String },                     // banner logo
    companyInfo: { type: String },
    listedJobs: [{ type: mongoose.Schema.Types.ObjectId, ref: "Jobdesc" }],
    companyType: { type: String, default: "productbased" },
    careerPageLink: { type: String },
    linkedinPageLink: { type: String },
    isPromoted: { type: Boolean, default: false },
});

companydetailsSchema.index({ companyName: 1 });

const CompanyLogo = mongoose.model("CompanyLogo", companydetailsSchema);
module.exports = CompanyLogo;
```

Notes: **no `timestamps`** on CompanyLogo, no slug, no soft-delete flag.
Bidirectional sync with `Jobdesc.company` is done manually inside controllers.

---

## 5. Route & Controller Conventions

### Organization

Two coexisting patterns in the repo:

**Pattern A — flat split (older core)**: `routes/<feature>.routes.js` +
`controllers/<feature>.controllers.js`. Routes import named exports from
controllers. Used by: `jobs`, `company`, `analytics`.

**Pattern B — feature-scoped folder (newer)**: everything co-located in a
single folder (`blog/`, `scraper/`). The folder contains its own
`*.routes.js`, `*.controllers.js`, `*.schema.js`, `*.validators.js`,
`*.service.js`. Used by: `blog`, `scraper`.

All routers are mounted under `/api` in [app.js:82-87](../app.js).

### Job-related route — `POST /api/jd/add`

**Route file** — [routes/jobs.routes.js](../routes/jobs.routes.js):

```js
const express = require("express");
const router = express.Router();

const requireAuth = require("../middleware/auth");
const validateObjectId = require("../middleware/validateObjectId");

const { getJobs, addJobs, updateClick, updateJob, deleteJobById } = require("../controllers/jobs.controllers");
const { getPosterLink } = require("../controllers/common");

router.get("/jd/get", getJobs);
router.post("/jd/add", requireAuth, addJobs);
router.delete("/jd/delete/:id", requireAuth, validateObjectId, deleteJobById);
router.put("/jd/update/:id", requireAuth, validateObjectId, updateJob);
router.patch("/jd/update/count/:id", validateObjectId, updateClick);
router.post("/jd/getposterlink", requireAuth, getPosterLink);

module.exports = router;
```

**Controller file** — [controllers/jobs.controllers.js](../controllers/jobs.controllers.js)
(named exports `addJobs`, `updateJob`, etc. — see lines 230–285 for `addJobs`).

**Validator file** — **none**. Jobs has no Zod schema. Instead the controller
uses an `allowedFields` allow-list string array to pick fields off `req.body`
(see [jobs.controllers.js:187-198](../controllers/jobs.controllers.js) and
`238-249`). Tags are parsed from a comma-separated string:
`tagsArray = tags.split(',')` ([jobs.controllers.js:183-185](../controllers/jobs.controllers.js)).

**Middleware applied**:
- `requireAuth` — [middleware/auth.js](../middleware/auth.js)
- `validateObjectId` — [middleware/validateObjectId.js](../middleware/validateObjectId.js) (only for `:id` routes)
- Global: `helmet()`, `cors()`, `express.json({ limit: "1mb" })`, `rateLimit` (read vs write), `express-fileupload` — see [app.js:41-79](../app.js).

### Company-related route — `POST /api/companydetails/add`

**Route file** — [routes/company.routes.js](../routes/company.routes.js):

```js
const express = require("express");
const router = express.Router();

const requireAuth = require("../middleware/auth");
const validateObjectId = require("../middleware/validateObjectId");

const { addCompanyDetails, getCompanyDetails, getCompanyLogo, updateCompanyDetails, deleteCompanyDetails } = require("../controllers/company.controllers");

router.post("/companydetails/add", requireAuth, addCompanyDetails);
router.get("/companydetails/get", getCompanyDetails);
router.get("/companydetails/logo", getCompanyLogo);
router.put("/companydetails/update/:id", requireAuth, validateObjectId, updateCompanyDetails);
router.delete("/companydetails/delete/:id", requireAuth, validateObjectId, deleteCompanyDetails);

module.exports = router;
```

**Controller file** — [controllers/company.controllers.js](../controllers/company.controllers.js)
(see `addCompanyDetails` at lines 6–26).

**Validator file** — **none**. Same `allowedFields` allow-list pattern as
jobs ([company.controllers.js:7-14](../controllers/company.controllers.js)).

**Middleware applied**: same as jobs (`requireAuth`, `validateObjectId` for
`:id` routes).

### Request → response flow (4–6 bullets)

1. Request enters [app.js](../app.js) → hits `cors()`, `helmet()`, rate-limiter
   (GET = `readLimiter` 300/15min, write = `writeLimiter` 100/15min),
   `express-fileupload`, `express.json`.
2. Router match: `/api` prefix routes to one of the feature routers registered
   in `app.js:82-87`.
3. Route-level middleware runs in order: `requireAuth` (for write routes),
   then `validateObjectId` (for `:id` routes), then optionally a Zod `validate(schema)`
   wrapper (blog only — attaches to `req.validated`).
4. Controller handler executes: reads query/body, builds a Mongoose query (with
   `escapeRegex` from [Helpers/controllerHelper.js](../Helpers/controllerHelper.js)
   for any text search), hits MongoDB.
5. Response shape depends on endpoint (see §8): job GETs return
   `{ data, totalCount }` via `jobDetailsHandler`; writes return
   `{ message }`; errors return `{ error }` via `apiErrorHandler`.
6. Uncaught errors in controllers go through `try/catch` → `apiErrorHandler(err, res)`
   which logs to `console.error` and responds `500 { error: "Internal server error" }`.

---

## 6. Validation (Zod)

Zod is **only used in the `blog` module**. The core `jobs` and `company`
controllers use an inline `allowedFields` allow-list instead.

### Example schema + route wiring — [blog/blog.validators.js](../blog/blog.validators.js)

```js
const { z } = require("zod");

const createBlogSchema = z.object({
    title: z.string().min(1).max(200).refine(noHtml, { message: "HTML not allowed in title" }),
    content: z.string().min(1),
    category: z.string().min(1).max(100),
    author: authorSchema,
    excerpt: z.string().max(300).refine(noHtml, ...).optional(),
    tags: z.array(z.string().max(50)).max(10).optional(),
    coverImage: coverImageSchema,
    seo: seoSchema,
    slug: z.string().max(200).optional(),
});

const validate = (schema) => (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
        return res.status(400).json({
            error: "Validation failed",
            details: result.error.issues.map((i) => ({
                path: i.path.join("."),
                message: i.message,
            })),
        });
    }
    req.validated = result.data;
    next();
};
```

### How it's applied — [blog/blog.admin.routes.js:23-28](../blog/blog.admin.routes.js)

```js
router.post("/admin/blogs", requireAuth, validate(createBlogSchema), createBlog);
router.patch("/admin/blogs/:id", requireAuth, validateObjectId, validate(updateBlogSchema), updateBlog);
router.post("/admin/blogs/:id/publish", requireAuth, validateObjectId, validate(publishBlogSchema), publishBlog);
```

The controller reads the validated payload off `req.validated`:
`const data = req.validated;` ([blog.controllers.js:37](../blog/blog.controllers.js)).

There is also a `validateQuery(schema)` helper (pulls from `req.query` into
`req.validatedQuery`) but it is **not wired into any route** yet.

---

## 7. Auth

### Firebase Admin init — [config/firebase.js](../config/firebase.js)

```js
const admin = require("firebase-admin");

const serviceAccount = {
    type: "service_account",
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
};

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID,
});

module.exports = admin;
```

Bootstrapped via side-effect `require("./config/firebase")` at
[app.js:25](../app.js).

### Auth middleware — [middleware/auth.js](../middleware/auth.js)

`requireAuth`:
1. If `Authorization: Bearer <token>` present, tries `admin.auth().verifyIdToken(token)`.
   On success: attaches `req.firebaseUser = { uid, email, emailVerified }`,
   calls `next()`.
2. If token is long (>100 chars) and verification fails → **401 Unauthorized**.
3. Otherwise falls through to a **legacy path**: `x-api-key` header or short
   Bearer token compared against `process.env.ADMIN_API_KEY`. On success,
   stamps `req.firebaseUser = { uid: "legacy-api-key", email: "admin@internal" }`
   and logs a deprecation warning.
4. Neither matches → **401 Unauthorized**.

A **separate** admin guard exists for scraper routes —
[scraper/admin.routes.js:12-18](../scraper/admin.routes.js):

```js
function requireAdminSecret(req, res, next) {
    const secret = req.headers["x-admin-secret"];
    if (!secret || secret !== process.env.ADMIN_SECRET) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    next();
}
router.use("/admin", requireAdminSecret);
```

Note: this guard is scoped to the scraper router *only*; the blog admin routes
(`/admin/blogs/*`) use `requireAuth` (Firebase/API-key) instead.

### Route protection matrix

| Route | Guard |
|---|---|
| `GET  /api/jd/get`            | **public** |
| `POST /api/jd/add`            | `requireAuth` |
| `PUT  /api/jd/update/:id`     | `requireAuth` + `validateObjectId` |
| `PATCH /api/jd/update/count/:id` | **public** + `validateObjectId` |
| `DELETE /api/jd/delete/:id`   | `requireAuth` + `validateObjectId` |
| `POST /api/jd/getposterlink`  | `requireAuth` |
| `GET  /api/companydetails/get`    | **public** |
| `GET  /api/companydetails/logo`   | **public** |
| `POST /api/companydetails/add`    | `requireAuth` |
| `PUT  /api/companydetails/update/:id` | `requireAuth` + `validateObjectId` |
| `DELETE /api/companydetails/delete/:id` | `requireAuth` + `validateObjectId` |
| `GET  /api/analytics/*`           | `requireAuth` (mounted via `router.use`) |
| `GET  /api/blogs*` (public)       | **public** (plus `Cache-Control` headers) |
| `/api/admin/blogs*`               | `requireAuth` (+ Zod validators) |
| `POST /api/admin/upload`          | `requireAuth` |
| `/api/admin/scrape/*`             | `requireAdminSecret` (`x-admin-secret`) |

---

## 8. Response Shapes

### Three sample endpoints

**A. `GET /api/jd/get` — list jobs**

Success path goes through
[Helpers/controllerHelper.js:71-78](../Helpers/controllerHelper.js):

```js
exports.jobDetailsHandler = async (result, res, conditions, filteredData = 0) => {
    var data = {
        totalCount: await countTotalEntries(conditions, filteredData),
        data: !!filteredData ? filterData(result) : result,
    };
    return res.status(200).send(data);
};
```

Success: `200 { totalCount, data }` (no `success` boolean).
Invalid `id`: `400 { error: "Invalid job ID" }` ([jobs.controllers.js:30](../controllers/jobs.controllers.js)).
Server error: `500 { error: "Internal server error" }` via `apiErrorHandler`.

**B. `POST /api/jd/add` — create job**

Success: `201 { message: "Data added successfully" }`
([jobs.controllers.js:279-281](../controllers/jobs.controllers.js)).
File-type error: `400 { error: "Invalid file type. Allowed: jpeg, png, webp, svg" }`.
Server error: `500 { error: "Internal server error" }`.

**C. `GET /api/companydetails/get` — list companies**

Success: `200 { data, pagination: { currentPage, totalPages, totalCount, pageSize } }`
([company.controllers.js:60-68](../controllers/company.controllers.js)).
Invalid id: `400 { error: "Invalid company ID" }`.
Server error: `500 { error: "Internal server error" }`.

**D. (Bonus) Blog validation error** — `POST /api/admin/blogs`

Success: `201 { message: "Blog draft created", data: { _id, slug } }`.
Validation fail: `400 { error: "Validation failed", details: [{ path, message }] }`.
Duplicate slug: `409 { error: "A blog with this slug already exists" }`
([blog.controllers.js:48-50](../blog/blog.controllers.js)).

### Status code conventions observed

| Situation | Code | Example |
|---|---|---|
| Create success | **201** | `201 { message: "Data added successfully" }` (jobs), `201 { message: "Blog draft created", data: {...} }` (blog) |
| Read/update/delete success | **200** | `200 { message: "Successfully Updated" }`, `200 { message: "Deleted Successfully" }` |
| Validation error (body/id format) | **400** | `400 { error: "Invalid ID format" }`, `400 { error: "Validation failed", details: [...] }` (Zod) |
| Not found | **404** | `404 { error: "Job not found" }`, `404 { error: "Company not found" }`, `404 { error: "Blog not found" }` |
| Duplicate resource | **409** | `409 { error: "A blog with this slug already exists" }` (only used in blog; relies on Mongo `err.code === 11000`) |
| Unauthenticated | **401** | `401 { error: "Unauthorized" }` or `401 { error: "Invalid or expired token" }` |
| Forbidden | **not used** | No 403 anywhere — the auth middleware short-circuits to 401 for all access-denied cases |
| Server error | **500** | `500 { error: "Internal server error" }` via `apiErrorHandler` |

### Shape inconsistencies to be aware of

- **No global `{ success, data, error }` envelope.** Responses are a mix of:
  - `{ totalCount, data }` (jobs list)
  - `{ data, pagination }` (company list)
  - `{ data, totalCount, page, size }` (blog list, scraper staging list)
  - `{ data }` (blog detail, company logo)
  - `{ message }` (writes) or `{ message, data: {...} }` (blog create)
  - `{ error }` (errors) — never `{ success: false, error }`
- `res.send(data)` vs `res.json(data)` is inconsistent (both are used). Not
  functionally different for JSON, but worth noting for rewrites.
- The project-level `CLAUDE.md` claims responses use `{ success, data, error }`
  — that claim is **stale**; it does not match the actual code.

---

## 9. Error Handling

### No global Express error middleware

There is **no `app.use((err, req, res, next) => …)`** anywhere. `app.js` ends
at `app.listen(…)` without registering an error handler or a 404 catch-all.

### Per-route `try/catch` + `apiErrorHandler`

The shared helper — [Helpers/controllerHelper.js:8-13](../Helpers/controllerHelper.js):

```js
exports.apiErrorHandler = (err, res) => {
    console.error("API Error:", err);
    return res.status(500).json({
        error: "Internal server error",
    });
};
```

Usage pattern in every controller:

```js
try {
    // ... mongoose call
} catch (err) {
    return apiErrorHandler(err, res);
}
```

Some controllers bypass the helper and inline `console.error(...)` +
`res.status(500).json({ error: "Internal server error" })` — see
[company.controllers.js:70-72](../controllers/company.controllers.js),
`101-103`, `124-126`. Same outcome, duplicated code.

The scraper admin routes return the raw `err.message` to the client:
`return res.status(500).json({ error: err.message });`
([scraper/admin.routes.js:31](../scraper/admin.routes.js)) — **leaks internals**
and should be tightened in the migration.

Special cases:
- Duplicate key (`err.code === 11000`) is caught explicitly in blog
  create/update → 409.
- Fire-and-forget errors (click event insert, view increment, revalidation
  webhook) are swallowed with `.catch((err) => console.error(...))`.

---

## 10. Logging

**Logger: `console`.** No `winston`, `pino`, `bunyan`, or any structured
logger installed (confirmed via package.json grep + source grep — zero matches).

Usage patterns:
- `console.log("Server running on port …")` — startup ([app.js:91](../app.js))
- `console.log("MongoDB connected successfully")` ([DB/connection.js:14](../DB/connection.js))
- `console.error("API Error:", err)` — inside `apiErrorHandler`
- `console.warn("DEPRECATED: Legacy x-api-key auth used on", req.method, req.url)`
  ([middleware/auth.js:33](../middleware/auth.js))
- `console.error(`[Blog] Revalidation failed:`, err.message)` — ad-hoc prefixed tags
- `console.error(`[Admin] Manual scrape run failed: ${err.message}`)`

No request logging middleware (no `morgan`, no `pino-http`). No log levels,
no log formatter, no redaction.

---

## 11. Existing Migration / Script Conventions

- **No `migration/` folder** existed before this prompt created it.
- **No `scripts/` folder**.
- **No runnable one-shot scripts** in the repo. Nothing to copy the pattern from.
- The only "background job" infrastructure is `node-cron`-driven schedulers,
  kicked off from `app.listen` callback:
  - [scraper/scheduler.js](../scraper/scheduler.js) — `scheduler.init()`
  - [blog/blog.scheduler.js](../blog/blog.scheduler.js) — `blogScheduler.init()`
  These share the main app's Mongoose connection — they are **not** standalone
  processes.

**Implication for prompts 2–8:** future migration scripts need a brand-new
convention. Suggested pattern for later prompts (not implemented here — this
report is read-only):
- Drop scripts under `migration/NN-name.js`.
- Each script should `dotenv.config()`, `await mongoose.connect(process.env.DATABASE)`,
  do its work, then `await mongoose.disconnect()` and `process.exit(0)`.
- Do **not** reuse `DB/connection.js` as-is — it kicks off retries and never
  exits, which would hang a one-shot CLI script.

---

## 12. Tests

### Jest is configured

[jest.config.js](../jest.config.js):

```js
module.exports = {
    testEnvironment: "node",
    testMatch: ["**/__tests__/**/*.test.js"],
    testTimeout: 30000,
};
```

Run with `npm test` → `jest --forceExit --detectOpenHandles`.

### Test layout

All tests live in [__tests__/](../__tests__):
- `jobs.test.js` — 30+ cases covering every jobs route
- `company.test.js` — company CRUD cases
- `security.test.js` — auth/CORS/rate-limit/file-upload checks
- `createApp.js` — test-only factory that wires just `express.json`,
  `express-fileupload`, and the two core routers (no helmet/rate-limit/auth
  plugins). Tests use `supertest` against the app returned by this factory.
- `setup.js` — boots an in-memory MongoDB via `mongodb-memory-server`, resets
  all collections between tests.

### Setup file — [__tests__/setup.js](../__tests__/setup.js)

```js
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

process.env.ADMIN_API_KEY = "test-secret-key";

let mongoServer;

beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
});

afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
});

afterEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
        await collections[key].deleteMany({});
    }
});
```

### Example test — [__tests__/jobs.test.js](../__tests__/jobs.test.js)

```js
const request = require("supertest");
const mongoose = require("mongoose");

require("./setup");
const createApp = require("./createApp");
const Jobdesc = require("../model/jobs.schema");
const CompanyLogo = require("../model/company.schema");

jest.mock("cloudinary", () => ({
    v2: {
        config: jest.fn(),
        uploader: {
            upload: jest.fn().mockResolvedValue({ secure_url: "https://cloudinary.com/test.jpg" }),
        },
    },
}));

let app;
const AUTH = { "x-api-key": "test-secret-key" };

beforeAll(() => {
    app = createApp();
});

describe("POST /api/jd/add", () => {
    it("should add a new job", async () => {
        const res = await request(app).post("/api/jd/add").set(AUTH).send({
            title: "New Job",
            link: "https://example.com/job",
            companyName: "TestCorp",
            jobtype: "fulltime",
        });

        expect(res.status).toBe(201);
        expect(res.body.message).toBe("Data added successfully");
    });
});
```

### Things to note for migration work

- Tests use the **legacy `x-api-key`** auth path (`AUTH = { "x-api-key": "test-secret-key" }`).
  Firebase token verification is not exercised — the middleware's short-token
  fallback is what the test suite relies on.
- `createApp()` deliberately skips rate-limit, helmet, CORS, and the
  firebase `require("./config/firebase")` side-effect. Migration test harnesses
  should follow the same lean-app approach.
- Cloudinary is always mocked.

---

## 13. Environment Variables

From [app.js:10-16](../app.js), [.env.example](../.env.example), and grepped
`process.env.*` reads across the codebase.

### Hard-required (server won't boot without these)

| Var | Used in |
|---|---|
| `DATABASE` | Mongo connection string ([DB/connection.js:3](../DB/connection.js)) |
| `CLOUD_NAME`, `API_KEY`, `API_SECRET` | Cloudinary for jobs images ([controllers/jobs.controllers.js:12-15](../controllers/jobs.controllers.js)) |
| `FIREBASE_PROJECT_ID`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL` | Firebase Admin init ([config/firebase.js](../config/firebase.js)) |

### Optional / feature-gated

| Var | Purpose |
|---|---|
| `PORT` | default `5002` |
| `ADMIN_API_KEY` | legacy auth fallback ([middleware/auth.js:32](../middleware/auth.js)) |
| `ALLOWED_ORIGINS` | comma-separated CORS allowlist; defaults to `localhost:3000` only |
| `FIREBASE_PRIVATE_KEY_ID`, `FIREBASE_CLIENT_ID` | passed into service-account JSON; optional |
| `CLOUD_NAME2`, `API_KEY2`, `API_SECRET2` | Cloudinary account for ad posters ([controllers/common.js:4-7](../controllers/common.js)) |
| `ADMIN_SECRET` | scraper admin routes guard ([scraper/admin.routes.js:14](../scraper/admin.routes.js)) |
| `AI_PROVIDER`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `GROQ_MODEL`, `CLAUDE_API_KEY`, `CLAUDE_MODEL`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | scraper AI providers |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | scraper notifications |
| `BLOG_CLOUDINARY_FOLDER` | blog image namespace |
| `NEXT_REVALIDATION_URL` *or* `SITE_REVALIDATE_URL`, `REVALIDATE_SECRET` | Next.js ISR webhook from blog ([blog/blog.controllers.js:14-16](../blog/blog.controllers.js)) |
| `SITE_URL`, `SITE_TITLE`, `SITE_DESCRIPTION` | RSS feed metadata |

### Notes for migration scripts

- Env var for Mongo is **`DATABASE`**, *not* `MONGODB_URI`. New scripts should
  either use `DATABASE` directly to match the app, or fall back:
  `const uri = process.env.MONGODB_URI || process.env.DATABASE;`.
- `dotenv.config()` is called in `app.js` **before** any env read. One-shot
  scripts must call it themselves.
- `FIREBASE_PRIVATE_KEY` stores `\n` as literal `\\n` in `.env`;
  [config/firebase.js:7](../config/firebase.js) unescapes it with `.replace(/\\n/g, "\n")`.

---

## Appendix — Cheat sheet for subsequent prompts

- Module system: **CommonJS**. Use `require` / `module.exports`.
- Source layout: **no `src/`**; feature folders live at repo root.
- Existing patterns to preserve: `allowedFields` allow-list in jobs/company
  controllers; Zod + `validate(schema)` only in `blog/`.
- Response envelope: **not** `{ success, data, error }` — current code uses a
  mixed shape; prefer `{ data, ... }` for reads and `{ message }` for writes,
  `{ error, details? }` for failures.
- DB connect helper for scripts: **must be written fresh** — `DB/connection.js`
  is a side-effect boot file unsuitable for one-shot CLIs.
- Auth for write routes: `requireAuth` (Firebase Bearer, falls back to
  `x-api-key` + `ADMIN_API_KEY`).
- Tests: Jest + `mongodb-memory-server` + `supertest` via `__tests__/createApp.js`.
- Logger: plain `console`. No structured logger.
- Global error middleware: **none**.
- Slug generation: inline in `blog/blog.service.js`; no `slugify`/`nanoid` dep.
