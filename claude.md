# CareersAt.Tech Backend

## Project Overview
Backend API for careersattech.tech — an Indian tech job portal for freshers.
Powers job listings (legacy v1 + v2 schema), company profiles, a blog with
scheduled publishing, an admin-only AI scraping pipeline that ingests jobs
from third-party sites, click/view analytics, and a session-cookie-based
event tracker.

## Stack
- Runtime: Node.js >= 18
- Framework: Express.js v4.21
- Database: MongoDB (Mongoose v8 ODM)
- Image Storage: Cloudinary (dual accounts — one for jobs/blog, one for ads)
- Auth: Firebase Admin SDK token verification (Bearer JWT) with a deprecated
  `x-api-key` legacy fallback. Scraper admin routes use a separate `x-admin-secret`.
- AI Providers (scraper): Gemini, Groq, Anthropic Claude, OpenRouter — selected
  via `AI_PROVIDER` env var.
- Validation: Zod schemas for all v2 / blog / admin write endpoints.
- Security middleware: helmet, CORS allowlist, express-rate-limit (300 reads /
  100 writes per 15 min per IP), `express.json({ limit: "1mb" })`,
  `express-fileupload` capped at 5 MB.
- Tests: Jest + supertest + mongodb-memory-server.

## Project Structure
```
careersattech-Backend/
├── app.js                                 # Entry point. Validates required env, wires routers, starts schedulers.
├── DB/connection.js                       # Mongoose connection with retry/backoff
├── config/firebase.js                     # firebase-admin init from env
├── middleware/
│   ├── auth.js                            # requireAuth — Firebase Bearer + legacy x-api-key
│   ├── sessionCookie.js                   # cat_sess cookie + sha256(ip+pepper) hashing
│   └── validateObjectId.js                # 400 on bad :id
├── routes/
│   ├── jobs.routes.js                     # /api/jd/* (legacy v1)
│   ├── company.routes.js                  # /api/companydetails/*
│   ├── analytics.routes.js                # /api/analytics/* (admin)
│   ├── admin/
│   │   ├── jobsV2.routes.js               # /api/admin/jobs/v2/*
│   │   └── companiesV2.routes.js          # /api/admin/companies/v2/*
│   └── public/
│       └── jobsV2.routes.js               # /api/jobs/:slug/{apply,view}
├── controllers/
│   ├── jobs.controllers.js                # Legacy job CRUD + click tracking
│   ├── company.controllers.js             # Company CRUD
│   ├── analytics.controllers.js           # summary, jobs/clicks-over-time, top-jobs, by-category
│   ├── common.js                          # getPosterLink (Cloudinary upload)
│   ├── admin/{jobsV2,companiesV2}.controllers.js
│   └── public/jobsV2.controllers.js       # apply redirect + view logger
├── model/
│   ├── jobs.schema.js                     # Jobdesc (v1)
│   ├── company.schema.js                  # CompanyLogo (v1)
│   ├── jobV2.schema.js                    # JobV2 → collection "jobs_v2"
│   ├── companyV2.schema.js                # CompanyV2 → collection "companies_v2"
│   ├── jobClickEvent.schema.js            # v1 click event log
│   └── jobClickV2.schema.js               # v2 click events with TTL (180d)
├── validators/                            # Zod schemas: jobV2.js, companyV2.js
├── Helpers/controllerHelper.js            # apiErrorHandler, filterData, jobDetailsHandler, escapeRegex
├── utils/slugify.js                       # generateJobSlug (clean base), generateCompanySlug; date/random collision suffixes
├── Data/companycareerpage.json            # Static list of 100+ company career page URLs
├── blog/                                  # Blog module (schema, routes, controllers, scheduler, services)
│   ├── blog.schema.js                     # status: draft|scheduled|published|archived
│   ├── blog.routes.js                     # public: /api/blogs[, /sitemap, /rss, /related/:slug, /:slug]
│   ├── blog.admin.routes.js               # /api/admin/blogs/* + /api/admin/upload
│   ├── blog.controllers.js                # CRUD, publish, image upload, revalidation hook
│   ├── blog.scheduler.js                  # node-cron: every minute, scheduled→published
│   ├── blog.service.js                    # processBlogPost (slug, reading time, TOC)
│   ├── blog.validators.js                 # Zod create/update/publish schemas
│   ├── markdown.service.js                # remark/rehype pipeline → HTML
│   └── cloudinary.service.js              # blog image upload helper
├── scraper/                               # Admin-only AI ingestion pipeline
│   ├── admin.routes.js                    # /api/admin/scrape/* (auth via x-admin-secret)
│   ├── scheduler.js                       # node-cron 12:30 UTC (6PM IST) daily
│   ├── scraper.js                         # HTML fetch + Cheerio extraction
│   ├── transformer.js                     # LLM transform: raw page → structured job
│   ├── ingester.js                        # dedupe (fingerprint) + write to StagingJob
│   ├── notifier.js                        # Telegram alerts
│   ├── stopFlags.js                       # in-memory per-adapter stop signals
│   ├── adapters/                          # freshershunt, offcampusjobs4u, onlyfrontendjobs (+ _template)
│   ├── providers/                         # gemini, groq, claude, openrouter (selected by AI_PROVIDER)
│   └── models/{StagingJob,ScrapeLog}.js   # staging queue + run logs
├── migration/
│   ├── 01-08-*.md                         # v2 migration playbook docs
│   └── scripts/                           # seed-v2.js, verify-v2.js, e2e-v2.js, test-slugify.js
├── prompts/admin-company-panel.md         # LLM prompt(s)
├── __tests__/                             # company.test.js, jobs.test.js, security.test.js, setup.js, createApp.js
├── jest.config.js                         # node env, **/__tests__/**/*.test.js, 30s timeout
├── API_DOCS.md                            # Detailed endpoint reference (separate from this file)
├── .env.example
└── Temp/                                  # Experimental ad system (not wired to app.js)
```

## Key Commands
- `npm start` — production server (`node app.js`)
- `npm run dev` — dev server with nodemon
- `npm test` — Jest (`--forceExit --detectOpenHandles`)
- `npm run db:v2:seed` / `db:v2:seed:reset` — seed jobs_v2 / companies_v2
- `npm run db:v2:verify` — verify v2 data integrity
- `npm run db:v2:e2e` — end-to-end v2 check

## API Routes

### Jobs (v1) — `/api`
| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET    | `/jd/get`                    | —              | List/filter/paginate jobs |
| POST   | `/jd/add`                    | requireAuth    | Add job (multipart `photo` supported) |
| PUT    | `/jd/update/:id`             | requireAuth    | Update job (allowlisted fields only) |
| PATCH  | `/jd/update/count/:id`       | —              | Increment `totalclick`, log JobClickEvent |
| DELETE | `/jd/delete/:id`             | requireAuth    | Delete + unlink from company |
| POST   | `/jd/getposterlink`          | requireAuth    | Upload image → Cloudinary URL |

### Companies (v1) — `/api`
| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| POST   | `/companydetails/add`        | requireAuth | Create company |
| GET    | `/companydetails/get`        | —           | Fetch by id or name regex |
| GET    | `/companydetails/logo`       | —           | Logo fields only |
| PUT    | `/companydetails/update/:id` | requireAuth | Update company |
| DELETE | `/companydetails/delete/:id` | requireAuth | Delete company |

### Analytics (admin) — `/api/analytics` (all `requireAuth`)
- `GET /summary` — totals + period deltas (`period=7d|30d|90d|all`, default `30d`)
- `GET /jobs-over-time` — added vs expired, daily or weekly buckets
- `GET /clicks-over-time` — clicks bucketed daily/weekly
- `GET /top-jobs` — `period`, `limit` (1–50)
- `GET /jobs-by-category` — `groupBy ∈ {jobtype, workMode, location, companytype, tags}`

### Jobs v2 admin — `/api/admin/jobs/v2` (`requireAuth` + Zod validate)
`POST /`, `GET /`, `GET /:id`, `PATCH /:id`, `DELETE /:id` (soft-delete)

Apply-link cleanup (manual, on-demand — same verifier the cron uses):
- `POST /verify-now` — kick off a background scan of all published jobs;
  dead links auto-archive. Returns 202; only one scan runs at a time (409).
- `GET /verify-now/status` — `{ running, startedAt, lastRun }`.
- `GET /flagged` — review queue: jobs with `verification.lastCheckResult ===
  'expired'` and `deletedAt: null`. `?result=`, `?page=`, `?limit=`.
- `POST /flagged/purge` — bulk soft-delete; body `{ ids: [...] }` or
  `{ all: true }` (empty body → 400, no accidental wipe).
- Routes are declared **before** `/:id` so the literal paths aren't captured
  by the ObjectId param matcher.

### Companies v2 admin — `/api/admin/companies/v2` (`requireAuth` + Zod validate)
`POST /`, `GET /`, `GET /:id`, `PATCH /:id`, `DELETE /:id`

### Jobs v2 public — `/api/jobs` (sessionCookie middleware)
- `GET /:slug/apply` — log `apply_click`, 302 redirect to `applyLink`
- `POST /:slug/view` — log `detail_view`, increment `stats.pageViews`

### Blog public — `/api/blogs`
- `GET /` (list), `GET /:slug`, `GET /related/:slug`, `GET /sitemap`, `GET /rss`
- Responses set `Cache-Control: s-maxage=60, stale-while-revalidate=300`

### Blog admin — `/api/admin` (`requireAuth` + Zod validate)
- `POST /blogs`, `GET /blogs`, `GET /blogs/:id`, `PATCH /blogs/:id`,
  `DELETE /blogs/:id`, `POST /blogs/:id/publish`, `POST /upload`
- On publish/update, fires Next.js revalidation webhook if
  `NEXT_REVALIDATION_URL` + `REVALIDATE_SECRET` are set.

### Scraper admin — `/api/admin/scrape` (auth: `x-admin-secret` header)
- `POST /run` — kick off pipeline asynchronously
- `GET /staging`, `GET /staging/:id`, `DELETE /staging/:id`
- `POST /staging/:id/approve` — copy staging → `Jobdesc` (v1)
- `POST /staging/:id/reject`
- `POST /staging/approve-bulk` — `{ ids: [...] }`
- `GET /logs`, `GET /health`
- `POST /test-adapter/:name` — dry-run an adapter (no save)
- `POST /stop/:adapterName` — request adapter stop (cooperative)

### GET /jd/get query params
- `page`, `size` — pagination (size clamped 1–100)
- `query` — OR-search across `companyName`, `title`, `role`
- `companyname`, `batch`, `degree`, `jobtype`, `location`, `jobId` — case-insensitive regex
- `priority` — sort by priority desc, then `_id` desc
- `filterData` (default 1) — only active + non-expired jobs (DB-level)
- `id` — single job by ObjectId

## Data Models

### Jobdesc — v1 (`jobs.schema.js`)
`title`, `companyName`, `company` (ref CompanyLogo), `jobtype`, `role`, `salary`,
`salaryRange`, `batch`, `degree`, `experience`, `location`, `workMode`
(onsite/hybrid/remote), `skills`, `skilltags`, `tags`, `link`, `lastdate`,
`expiresAt`, `isActive`, `isFeaturedJob`, `priority`, `totalclick`, `adclick`,
`imagePath`, `jdbanner`, `platform`, `category`, `stipend`, `source`, `postedBy`,
`isVerified`.

### CompanyLogo — v1 (`company.schema.js`)
`companyName`, `smallLogo`, `largeLogo`, `companyInfo`, `listedJobs`
(refs Jobdesc), `companyType`, `careerPageLink`, `linkedinPageLink`, `isPromoted`.

### JobV2 → collection `jobs_v2`
Schema designed for Google for Jobs structured data. Required:
`title`, `slug` (unique), `company` (ObjectId → CompanyV2), `companyName`,
`displayMode` (`internal`|`external_redirect`), `applyLink`, `employmentType[]`,
`batch[]` (years 2020–2030, unique), `status` (`draft|published|paused|expired|archived`).
Optional: `jobDescription.{html,plain}` (required when `displayMode==='internal'` —
enforced by `pre('validate')`), `category`, `workMode`, `degree[]`,
`experience.{min,max}`, `jobLocation[]`, `baseSalary`, `requiredSkills[]`,
`preferredSkills[]`, `topicTags[]`, `applyPlatform`, `datePosted`, `validThrough`,
`isVerified`, `sponsorship.{tier,activeUntil}`, `priority`, `stats.{applyClicks,pageViews}`,
`jdBanner`, `seo.{metaTitle,metaDescription,ogImage}`, `source`, `externalJobId`,
`postedBy`, soft-delete via `deletedAt`. Includes text index on
title/companyName/jobDescription.plain/requiredSkills.

### CompanyV2 → collection `companies_v2`
`companyName` (case-insensitive unique via collation), `slug` (unique),
`logo.{icon,banner,iconAlt,bgColor}`, `description.{short,long}`, `companyType`,
`industry`, `tags[]`, `techStack[]`, `headquarters`, `locations[]`, `foundedYear`,
`employeeCount` (enum buckets), `website`, `careerPageLink`,
`socialLinks.{linkedin,twitter,instagram,glassdoor}`, `ratings.{glassdoor,ambitionBox}`,
`stats.{openJobsCount,totalJobsEverPosted}`, `status`, `isVerified`,
`sponsorship`, `seo`, soft-delete via `deletedAt`.

### JobClickEvent (v1)
`jobId` (ref Jobdesc), `source`, `timestamp`. Logged by `PATCH /jd/update/count/:id`.

### JobClickV2 → collection `job_clicks_v2`
`job` (ref JobV2), `eventType` (`impression|detail_view|apply_click|external_redirect`),
`sessionHash`, `userAgent`, `referrer`, `ipHash`, `timestamp`.
TTL index expires docs after 180 days.

### Blog (`blog/blog.schema.js`)
`title`, `slug` (unique), `excerpt`, `content`, `contentHtml`, `coverImage.*`,
`author.{name,avatar,bio,social}`, `category`, `tags[]`, `seo.*`, `readingTime`,
`wordCount`, `tableOfContents[]`, `status` (`draft|scheduled|published|archived`),
`publishedAt`, `scheduledFor`, `views`.

### StagingJob (scraper)
Buffered scraped jobs awaiting human approval. `status`
(`pending|approved|rejected`), `fingerprint` (unique, used for dedupe),
`source`, `sourceUrl`, `companyPageUrl`, `jobData` (mirrors Jobdesc fields),
`aiProvider`, `rejectedReason`, `approvedAt`.

### ScrapeLog (scraper)
Per-run summary: `runId`, `trigger` (`manual|cron`), `aiProvider`, per-adapter
results (`jobLinksFound`, `jobsFetched`, `jobsTransformed`, `jobsIngested`,
`jobsSkipped`, `errors[]`, `durationMs`, `status`), and totals.

## Conventions
- v1 controllers respond via `apiErrorHandler` / `jobDetailsHandler` —
  shape is `{ success, data, error }` (or `{ message }` for writes).
- v2 endpoints respond `{ data: ... }` with HTTP status codes; admin write
  errors carry `{ error }`.
- Tags accept comma-separated strings; controllers split into arrays.
- v1 job add/delete syncs bidirectionally with `CompanyLogo.listedJobs`.
- v1 update/add use a strict allowlist of writable fields (don't add new fields
  by spreading `req.body`).
- All regex query params go through `escapeRegex` before being used in `$regex`.
- v1 click counts: `totalclick` (apply) and `adclick` (ad) — incremented via PATCH;
  every apply also writes a JobClickEvent for time-series analytics.
- v2 click tracking is fire-and-forget; failures log but never block the response.
- `sessionCookie` middleware sets a 30-day `cat_sess` cookie and exposes
  `req.sessionHash` + `req.ipHash` (sha256 of ip + `CLICK_HASH_PEPPER`). Pepper
  is **required** — module throws on import if missing.
- Scraper pre-filters by fingerprint before calling the LLM (saves API calls).
- Blog publish/update fires a Next.js ISR revalidation webhook when configured.
- All v2 / blog / admin write routes validate with Zod before reaching the
  controller; validated payload is on `req.validated`.
- Mongo `_id` params are gated by `validateObjectId` middleware (400 on invalid).

## Auth model
- `requireAuth` (`middleware/auth.js`) accepts:
  1. `Authorization: Bearer <firebase-id-token>` — verified via firebase-admin,
     populates `req.firebaseUser = { uid, email, emailVerified }`.
  2. Legacy fallback: `x-api-key: <ADMIN_API_KEY>` or short Bearer token —
     logs a deprecation warning, sets `req.firebaseUser` to a stub.
- Scraper admin uses a separate `x-admin-secret: <ADMIN_SECRET>` header
  (different from `ADMIN_API_KEY`).
- Public read endpoints (jobs/companies/blogs lists, click increments) are
  unauthenticated.

## Rate limiting
- `/api/*` GET → 300 req / 15 min / IP
- `/api/*` non-GET → 100 req / 15 min / IP
- `app.set("trust proxy", 1)` is on — required for accurate IPs behind
  hosting platforms.

## Environment Variables
Required (server refuses to start without them):
```
DATABASE                # MongoDB connection string
CLOUD_NAME, API_KEY, API_SECRET                  # Cloudinary (jobs/blog)
FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL
CLICK_HASH_PEPPER       # required by sessionCookie middleware
```

Recommended:
```
PORT=5002
ALLOWED_ORIGINS=        # comma-separated; defaults to localhost:3000 with a warning
ADMIN_API_KEY=          # legacy auth fallback
ADMIN_SECRET=           # scraper admin routes
```

Optional:
```
CLOUD_NAME2, API_KEY2, API_SECRET2               # Cloudinary (ads)
FIREBASE_PRIVATE_KEY_ID, FIREBASE_CLIENT_ID

# Scraper
AI_PROVIDER=gemini      # gemini | groq | claude | openrouter
GEMINI_API_KEY, GROQ_API_KEY, GROQ_MODEL,
CLAUDE_API_KEY, CLAUDE_MODEL,
OPENROUTER_API_KEY, OPENROUTER_MODEL
SCRAPERAPI_KEY          # optional fetch proxy (5K free/month)
TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

# Blog
BLOG_CLOUDINARY_FOLDER=blog
NEXT_REVALIDATION_URL, REVALIDATE_SECRET
SITE_URL, SITE_TITLE, SITE_DESCRIPTION   # used by RSS feed

NODE_ENV=production     # gates secure cookie flag
```
Config file (gitignored): `.env`. See `.env.example` for template values.

## Schedulers
Both initialize after the server starts listening:
- `scraper/scheduler.js` — `30 12 * * *` (6 PM IST) runs the full scrape
  pipeline; checks for 5 consecutive failures and alerts via Telegram.
- `blog/blog.scheduler.js` — `* * * * *` (every minute) flips
  `scheduled → published` when `scheduledFor <= now` and triggers Next.js
  revalidation.

## Security Checklist (before every PR)
- [ ] Input sanitized (regex via `escapeRegex`) and validated (Zod for v2/blog/admin)
- [ ] Auth applied to all write/admin routes (`requireAuth` or `requireAdminSecret`)
- [ ] No sensitive data (tokens, raw DB errors, env values) in logs or responses
- [ ] Field allowlist enforced on update/add (no `Object.assign(doc, req.body)`)
- [ ] CORS origins reviewed if `ALLOWED_ORIGINS` changes
- [ ] Rate limits still apply to any new `/api/*` route
- [ ] `validateObjectId` on every `:id` route param
- [ ] No new env var read without `requiredEnvVars` update if startup-critical
