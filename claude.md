# CareersAt.Tech Backend

## Project Overview
Backend API for careersattech.tech — an Indian tech job portal for freshers.
Powers job listings (legacy v1 + v2 schema), company profiles, a blog with
scheduled publishing, an admin-only AI scraping pipeline that ingests jobs
from third-party sites, a manual "paste a URL → create a JobV2" scraper, an
apply-link expiry verifier, click/view analytics, and a session-cookie-based
event tracker.

## Stack
- Runtime: Node.js >= 18
- Framework: Express.js v4.21
- Database: MongoDB (Mongoose v8 ODM)
- Image Storage: Cloudinary (dual accounts — one for jobs/blog, one for ads)
- Auth: Firebase Admin SDK token verification (Bearer JWT) with a deprecated
  `x-api-key` legacy fallback. Scraper admin routes use a separate `x-admin-secret`.
- AI Providers (scraper): Gemini, Groq, Anthropic Claude, OpenRouter — selected
  via `AI_PROVIDER` env var (**default `groq`**).
- Email: Resend (apply-link verifier summary reports).
- Validation: Zod schemas for all v2 / blog / admin write endpoints.
- Security middleware: helmet, CORS allowlist, express-rate-limit (300 reads /
  100 writes per 15 min per IP), `express.json({ limit: "1mb" })`,
  `express-fileupload` capped at 5 MB, `query parser: simple` (blocks
  `?x[$ne]=` operator injection), and an **SSRF guard** on all outbound fetches.
- Tests: Jest + supertest + mongodb-memory-server.

## Project Structure
> The codebase is `src/`-based and organised by feature module. Each module
> folder owns its `*.routes.js`, `*.controller.js`, `*.model.js`,
> `*.validators.js`. `server.js` is the process entry; `src/app.js` builds the
> Express app (no `listen`), which keeps the app importable in tests.

```
careersattech-Backend/
├── server.js                              # Entry: connect DB, listen, init 3 schedulers
├── src/
│   ├── app.js                             # Builds Express app: security mw, CORS, routers, errorHandler
│   ├── config/
│   │   ├── index.js                       # Loads .env, validates REQUIRED vars (exits if missing), frozen config tree
│   │   ├── db.js                          # Mongoose connect with retry/backoff
│   │   ├── firebase.js                    # firebase-admin init from config
│   │   └── cloudinary.js                  # Cloudinary config (jobs/blog + ads accounts)
│   ├── middleware/
│   │   ├── auth.js                        # requireAuth — Firebase Bearer (+ optional admin claim) + legacy x-api-key
│   │   ├── adminSecret.js                 # requireAdminSecret — x-admin-secret (scraper), timing-safe compare
│   │   ├── sessionCookie.js               # cat_sess cookie + HMAC-sha256(ip, pepper); throws on import if pepper missing
│   │   ├── validate.js                    # validateBody/validateQuery (Zod) → req.validated / req.validatedQuery
│   │   ├── validateObjectId.js            # 400 on bad :id
│   │   ├── asyncHandler.js                # wraps async route fns → forwards rejections to errorHandler
│   │   └── errorHandler.js                # central error mw: ZodError/Validation/Cast/11000/status → JSON, else 500 (no stack leak)
│   ├── modules/
│   │   ├── jobs/                          # v1 jobs: jobs.{routes,controller,model}.js, common.controller.js (getPosterLink)
│   │   ├── companies/                     # v1 companies: companies.{routes,controller,model}.js
│   │   ├── analytics/                     # analytics.{routes,controller}.js (admin, /api/analytics/*)
│   │   ├── jobsV2/
│   │   │   ├── jobsV2.admin.routes.js     # /api/admin/jobs/v2/* CRUD + verify-now/flagged + scrape-and-post
│   │   │   ├── jobsV2.controller.js       # admin CRUD (Zod-validated, soft-delete)
│   │   │   ├── jobsV2.cleanup.controller.js  # verify-now, verify-now/status, flagged, flagged/purge
│   │   │   ├── jobsV2.verifyState.js      # in-memory single-flight state for verify-now
│   │   │   ├── jobsV2.scrape.controller.js   # scrape-and-post (paste URL → JobV2)
│   │   │   ├── jobsV2.public.routes.js    # /api/jobs/:slug/{apply,view} (sessionCookie)
│   │   │   ├── jobsV2.public.controller.js   # apply 302 redirect (scheme-guarded) + view logger
│   │   │   ├── jobsV2.publicRead.routes.js   # /api/jobs/v2/* (list, /slugs, /by-id/:id, /:slug, track-*)
│   │   │   ├── jobsV2.publicRead.controller.js
│   │   │   ├── jobsV2.{model,validators}.js
│   │   │   ├── jobClickEvent.model.js     # v1 click log
│   │   │   └── jobClickV2.model.js        # v2 click log, TTL 180d
│   │   ├── companiesV2/                   # admin CRUD + public read (.publicRead.*), model, validators
│   │   ├── blog/                          # blog.{routes,admin.routes,controller,model,service,validators}.js + markdown/cloudinary services
│   │   └── scraper/                       # AI ingestion pipeline (see below)
│   │       ├── scraper.admin.routes.js    # /api/admin/scrape/* (x-admin-secret); approve writes JobV2 + CompanyV2
│   │       ├── scraper.fetch.js           # HTML fetch (ScraperAPI key rotation + direct), Cheerio, SSRF-guarded
│   │       ├── ingester.js                # fingerprint dedupe + write StagingJob; company lookup
│   │       ├── transformer.js             # LLM transform: raw page → structured job
│   │       ├── notifier.js                # Telegram alerts
│   │       ├── stopFlags.js               # in-memory per-adapter cooperative stop
│   │       ├── adapters/                  # freshershunt, offcampusjobs4u, onlyfrontendjobs, freshersjobs, peerlist (+ _template)
│   │       ├── providers/                 # gemini, groq, claude, openrouter (selected by AI_PROVIDER)
│   │       ├── peerlist/                  # peerlist-specific constants/filters/scrub
│   │       └── models/{stagingJob,scrapeLog}.model.js
│   ├── services/
│   │   ├── jobScrapeFromUrl/              # paste-URL pipeline: fetchHtml → cleanHtml → extractJobFields(LLM) → resolveCompany → JobV2
│   │   │   ├── index.js                   # scrapeAndCreateJob orchestrator
│   │   │   ├── fetchHtml.js               # SSRF-guarded fetch with typed errors (Blocked/Failed/TooLarge/Timeout)
│   │   │   ├── cleanHtml.js, extractJobFields.js, resolveCompany.js, generateJobSlug.js
│   │   └── jobVerifier/                   # apply-link liveness checker
│   │       ├── index.js                   # verifyJob wrapper
│   │       ├── genericVerifier.js         # classify expired/active/inconclusive
│   │       ├── httpClient.js              # SSRF-guarded fetch (never throws on status)
│   │       ├── expiredPhrases.js, emailReporter.js (Resend)
│   ├── jobs/                              # cron schedulers (init'd by server.js after listen)
│   │   ├── scraper.scheduler.js           # runPipeline; main 30 12 * * * (6PM IST) + peerlist 0 9 * * * (09:00 UTC)
│   │   ├── blog.scheduler.js              # * * * * * — scheduled→published + revalidate
│   │   └── verifyJobs.scheduler.js        # runVerification; default 0 3 */3 * *, gated by VERIFY_JOBS_ENABLED
│   └── utils/
│       ├── controllerHelper.js            # apiErrorHandler, filterData, jobDetailsHandler, countTotalEntries, escapeRegex
│       ├── escapeRegex.js, slugify.js, pagination.js, companyNameMatch.js
│       ├── safeEqual.js                   # crypto.timingSafeEqual wrapper (length-checked)
│       ├── urlGuard.js                    # SSRF guard: public-URL checks + DNS-resolving guarded http/https agents
│       └── logger.js                      # winston; redacts authorization/x-api-key/x-admin-secret/token/etc
├── scripts/
│   ├── verifyJobs.js                      # standalone verifier runner
│   └── migrations/addVerificationFields.js
├── migration/scripts/                     # seed-v2.js, verify-v2.js, e2e-v2.js, fix-companies-v1Id-index.js, inspect-job.js
├── __tests__/                             # supertest + unit suites (setup.js, createApp.js); plus per-module *.test.js under src/**/__tests__
├── jest.config.js                         # node env, **/__tests__/**/*.test.js, 30s timeout
├── API_DOCS.md                            # Detailed endpoint reference (separate from this file)
├── .env.example
└── Temp/                                  # Experimental ad system (not wired to app.js)
```

## Key Commands
- `npm start` — production server (`node server.js`)
- `npm run dev` — dev server with nodemon
- `npm test` — Jest (`--forceExit --detectOpenHandles`)
- `npm run db:v2:seed` / `db:v2:seed:reset` — seed jobs_v2 / companies_v2
- `npm run db:v2:verify` — verify v2 data integrity
- `npm run db:v2:e2e` — end-to-end v2 check

## API Routes

### Jobs (v1) — `/api`
| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET    | `/jd/get`                    | —              | List/filter/paginate jobs (`.lean()`) |
| POST   | `/jd/add`                    | requireAuth    | Add job (multipart `photo` supported) |
| PUT    | `/jd/update/:id`             | requireAuth    | Update job (allowlisted fields only) |
| PATCH  | `/jd/update/count/:id`       | —              | Increment `totalclick`, log JobClickEvent |
| DELETE | `/jd/delete/:id`             | requireAuth    | Delete + unlink from company |
| POST   | `/jd/getposterlink`          | requireAuth    | Upload image → Cloudinary URL |

### Companies (v1) — `/api`
`POST /companydetails/add` (auth), `GET /companydetails/get`,
`GET /companydetails/logo`, `PUT /companydetails/update/:id` (auth),
`DELETE /companydetails/delete/:id` (auth).

### Analytics (admin) — `/api/analytics` (all `requireAuth`)
- `GET /summary` — totals + period deltas (`period=7d|30d|90d|all`, default `30d`)
- `GET /jobs-over-time`, `GET /clicks-over-time` — daily/weekly buckets
- `GET /top-jobs` — `period`, `limit` (1–50)
- `GET /jobs-by-category` — `groupBy ∈ {jobtype, workMode, location, companytype, tags}`
- Merges legacy (Jobdesc/JobClickEvent) + v2 (JobV2/JobClickV2); all counts run in `Promise.all`.

### Jobs v2 admin — `/api/admin/jobs/v2` (`requireAuth` + Zod validate)
`POST /`, `GET /`, `GET /:id`, `PATCH /:id`, `DELETE /:id` (soft-delete via `deletedAt`).

Apply-link cleanup (manual, on-demand — same verifier the cron uses):
- `POST /verify-now` — background scan of all published jobs; dead links
  auto-archive. 202; single-flight (409 if already running).
- `GET /verify-now/status` — `{ running, startedAt, lastRun }`.
- `GET /flagged` — review queue: `verification.lastCheckResult ∈
  {expired, inconclusive}`, `deletedAt: null`. `?result=`, `?page=`, `?limit=`.
- `POST /flagged/purge` — bulk soft-delete; body `{ ids: [...] }` or
  `{ all: true }` (empty body → 400, no accidental wipe).
- These literal paths are declared **before** `/:id` so the ObjectId matcher
  doesn't swallow them.

Manual scrape-and-post:
- `POST /admin/jobs/scrape-and-post` (`requireAuth`, per-user 5/min limiter,
  Zod `{ applyLink }`) — fetch the apply URL, LLM-extract fields, resolve/create
  the company, create a published JobV2. **SSRF-guarded** (see Security).

### Companies v2 admin — `/api/admin/companies/v2` (`requireAuth` + Zod validate)
`POST /`, `GET /`, `GET /:id`, `PATCH /:id`, `DELETE /:id`.

### Jobs v2 public read — `/api/jobs/v2`
- `GET /` — filtered/paginated list (`batch`, `employmentType`, `workMode`,
  `topicTags`, `search`, `company` slug, `sort`, `includeExpired`); sponsorship
  ranking via aggregation when `sort=sponsorship:desc`.
- `GET /slugs` — all published slugs (5-min in-process cache).
- `GET /by-id/:id` — legacy v1Id → `{ slug }` (410 if gone).
- `GET /:slug` — full detail + `isExpired`.
- `POST /:slug/track-view`, `POST /:slug/track-apply` — fire-and-forget 204;
  per-IP+slug limiter (10/min, silent 204 on limit).

### Jobs v2 public (tracked redirect) — `/api/jobs` (sessionCookie)
- `GET /:slug/apply` — log `apply_click`, 302 redirect to `applyLink`
  (**scheme-guarded**: only http/https/mailto, else 404).
- `POST /:slug/view` — log `detail_view`, increment `stats.pageViews`.
- These two POST-track paths are exempt from the global write limiter.

### Companies v2 public read — `/api/companies/v2`
List + detail-by-slug (published/active only).

### Blog public — `/api/blogs`
`GET /` (list), `GET /:slug`, `GET /related/:slug`, `GET /sitemap`, `GET /rss`.
Responses set `Cache-Control: s-maxage=60, stale-while-revalidate=300`
(sitemap/rss 1h). RSS output is XML-escaped.

### Blog admin — `/api/admin` (`requireAuth` + Zod validate)
`POST /blogs`, `GET /blogs`, `GET /blogs/:id`, `PATCH /blogs/:id`,
`DELETE /blogs/:id` (archive), `POST /blogs/:id/publish`, `POST /upload`.
On publish/update, fires the Next.js ISR revalidation webhook when
`NEXT_REVALIDATION_URL` + `REVALIDATE_SECRET` are set.

### Scraper admin — `/api/admin/scrape` (auth: `x-admin-secret` header)
- `POST /run` — async pipeline (optional `{ adapter }` to run one adapter)
- `GET /staging`, `GET /staging/:id`, `DELETE /staging/:id`
- `POST /staging/:id/approve` — resolve/create **CompanyV2**, create **JobV2**
  (allowlisted overrides only); publish-readiness gated
- `POST /staging/:id/reject`, `POST /staging/approve-bulk` (`{ ids }`)
- `GET /logs`, `GET /health`
- `POST /test-adapter/:name` — dry-run an adapter (no save)
- `POST /stop/:adapterName` — cooperative stop

### GET /jd/get query params
`page`, `size` (clamped 1–100); `query` (OR across companyName/title/role);
`companyname`, `batch`, `degree`, `jobtype`, `location`, `jobId`
(case-insensitive regex, all `escapeRegex`-sanitised); `priority` (sort);
`filterData` (default 1 — active + non-expired at DB level); `id` (single by ObjectId).

## Data Models
(Mongoose; collection in parens.)

- **Jobdesc — v1** (`jobs.model.js`): `title`, `companyName`, `company`
  (ref CompanyLogo), `jobtype`, `role`, `salary`, `salaryRange`, `batch`,
  `degree`, `experience`, `location`, `workMode`, `skills`, `skilltags`,
  `tags`, `link`, `lastdate`, `expiresAt`, `isActive`, `isFeaturedJob`,
  `priority`, `totalclick`, `adclick`, `imagePath`, `jdbanner`, `platform`,
  `category`, `stipend`, `source`, `postedBy`, `isVerified`. Indexed on the
  filter/sort fields incl. `{isActive,expiresAt,_id}`.
- **CompanyLogo — v1** (`companies.model.js`): `companyName`, `smallLogo`,
  `largeLogo`, `companyInfo`, `listedJobs` (refs Jobdesc), `companyType`,
  `careerPageLink`, `linkedinPageLink`, `isPromoted`.
- **JobV2** (`jobs_v2`): designed for Google for Jobs. Required `title`,
  `slug` (unique), `company` (→ CompanyV2), `companyName`, `displayMode`
  (`internal`|`external_redirect`), `applyLink`, `employmentType[]`,
  `batch[]` (2020–2030, unique), `status`
  (`draft|published|paused|expired|archived`). Optional `jobDescription.{html,plain}`
  (html required when `displayMode==='internal'` — `pre('validate')`),
  `category`, `workMode`, `degree[]`, `experience.{min,max}`, `jobLocation[]`,
  `baseSalary`, `requiredSkills[]`, `preferredSkills[]`, `topicTags[]`,
  `applyPlatform`, `datePosted`, `validThrough`, `isVerified`,
  `sponsorship.{tier,activeUntil}`, `priority`, `stats.{applyClicks,pageViews}`,
  `jdBanner`, `seo.*`, `source`, `externalJobId`, `postedBy`,
  `verification.{lastCheckedAt,lastCheckResult,lastCheckReason,lastCheckStatusCode,
  lastCheckFinalUrl,consecutiveInconclusive}`, `archivedAt`, `archivedReason`,
  soft-delete `deletedAt`. Compound indexes on status+sort/filter combos +
  text index (title/companyName/jobDescription.plain/requiredSkills).
- **CompanyV2** (`companies_v2`): `companyName` (case-insensitive unique via
  collation), `slug` (unique), `logo.*`, `description.{short,long}`,
  `companyType`, `industry`, `tags[]`, `techStack[]`, `headquarters`,
  `locations[]`, `foundedYear`, `employeeCount`, `website`, `careerPageLink`,
  `socialLinks.*`, `ratings.*`, `stats.*`, `status`, `isVerified`,
  `sponsorship`, `seo`, soft-delete `deletedAt`.
- **JobClickEvent — v1**: `jobId` (ref Jobdesc), `source`, `timestamp`.
- **JobClickV2** (`job_clicks_v2`): `job` (ref JobV2), `eventType`
  (`impression|detail_view|apply_click|external_redirect`), `sessionHash`,
  `userAgent`, `referrer`, `ipHash`, `timestamp`. TTL 180d.
- **Blog** (`blog.model.js`): `title`, `slug` (unique), `excerpt`, `content`,
  `contentHtml`, `coverImage.*`, `author.*`, `category`, `tags[]`, `seo.*`,
  `readingTime`, `wordCount`, `tableOfContents[]`, `status`
  (`draft|scheduled|published|archived`), `publishedAt`, `scheduledFor`, `views`.
- **StagingJob** (scraper): `status` (`pending|approved|rejected`),
  `fingerprint` (unique dedupe key), `source`, `sourceUrl`, `companyPageUrl`,
  `jobData`, `companyData`, `matchedCompany`, `approvedJob`, `aiProvider`,
  `rejectedReason`, `approvedAt`.
- **ScrapeLog** (scraper): `runId`, `trigger` (`manual|cron`), `aiProvider`,
  per-adapter results + totals.

## Conventions
- v1 controllers respond via `apiErrorHandler` / `jobDetailsHandler` —
  `{ totalCount, data }` for reads, `{ message }` for writes.
- v2/blog/admin respond `{ data }` (or `{ jobs, total, page, totalPages }`)
  with HTTP status codes; write errors carry `{ error }`.
- v1 read queries use `.lean()` (plain objects — the `id` virtual is not in
  JSON output anyway, so this is shape-preserving and faster).
- Tags accept comma-separated strings; controllers split into arrays.
- v1 job add/delete syncs bidirectionally with `CompanyLogo.listedJobs`.
- v1 update/add and scraper approve use a strict **allowlist** of writable
  fields — never spread `req.body` into a model.
- All regex query params go through `escapeRegex` before `$regex`.
- v2 click tracking is fire-and-forget; failures log but never block the response.
- `sessionCookie` sets a 30-day `cat_sess` cookie and exposes `req.sessionHash`
  + `req.ipHash` (HMAC-sha256 of ip + `CLICK_HASH_PEPPER`). Pepper is
  **required** — module throws on import if missing.
- Scraper pre-filters by fingerprint before calling the LLM (saves API calls).
- Blog publish/update fires the Next.js ISR revalidation webhook when configured.
- All v2/blog/admin write routes validate with Zod before the controller;
  payload is on `req.validated` (query on `req.validatedQuery`).
- Mongo `_id` params gated by `validateObjectId` (400 on invalid).
- Async route handlers either try/catch → `apiErrorHandler`, or are wrapped by
  `asyncHandler` so rejections reach the central `errorHandler` (which never
  leaks stack traces in responses).

## SSRF guard (`src/utils/urlGuard.js`)
Any outbound HTTP fetch of an attacker-influenced URL (admin-pasted apply
links, scraped career-page links, stored apply links the verifier re-checks)
**must** go through the guard. Two layers:
1. `isPublicHttpUrl` / `isPublicHttpsUrl` (and `assert*` variants) — reject
   non-HTTP(S) schemes and private targets *before* dialling. Canonicalises
   IPv4 in decimal/hex/octal/short form and unwraps IPv4-mapped IPv6, so
   `http://2130706433/`, `http://0x7f000001/`, `http://127.1/`,
   `http://[::ffff:127.0.0.1]/` and `http://169.254.169.254/` are all blocked,
   along with loopback/RFC1918/link-local/CGNAT and `.internal`/`.local`.
2. `guardedAxiosAgents` (`{ httpAgent, httpsAgent }`) — a DNS-resolving `lookup`
   that re-checks the **resolved** IP at connect time, for every redirect hop.
   This is the real boundary: it stops DNS-rebinding (a public hostname that
   resolves to a private address). Spread it into the axios request config.

Wired into: `services/jobScrapeFromUrl/fetchHtml.js` (pre-check + post-redirect
re-check + agents), `services/jobVerifier/httpClient.js` (pre-check + agents;
a blocked target classifies as `inconclusive`, never archives), and
`modules/scraper/scraper.fetch.js`. Residual to be aware of: a target that
passes DNS at connect time but is internal-only at the TCP layer behind a proxy
is out of scope; keep the guard on the path and don't fetch fully-trusted-only
URLs without it.

## Auth model
- `requireAuth` (`middleware/auth.js`):
  1. `Authorization: Bearer <firebase-id-token>` — verified via firebase-admin →
     `req.firebaseUser = { uid, email, emailVerified, admin }`. If
     `FIREBASE_REQUIRE_ADMIN_CLAIM=true`, a non-admin token gets 403.
  2. Legacy fallback (only when `ADMIN_API_KEY` is set): `x-api-key` matched
     with `safeEqual` (timing-safe); logs a deprecation warning, stubs
     `req.firebaseUser`. Note: the admin SPA ships this key to the browser, so
     treat any `requireAuth` route as reachable by whoever holds that key.
- `requireAdminSecret` — scraper admin via `x-admin-secret` (`ADMIN_SECRET`,
  distinct from `ADMIN_API_KEY`), timing-safe.
- Public read endpoints (job/company/blog lists, click increments) are unauth.

## Rate limiting
- `/api/*` GET → 300 req / 15 min / IP; non-GET → 100 / 15 min / IP.
- v2 `track-view`/`track-apply` POSTs are exempt from the write limiter and have
  their own 10/min per-IP+slug limiter; `scrape-and-post` has a 5/min per-user limiter.
- `trust proxy` hop count is configurable via `TRUST_PROXY` (default 1).

## Environment Variables
Required (server exits if missing):
```
DATABASE                # MongoDB connection string
CLOUD_NAME, API_KEY, API_SECRET                  # Cloudinary (jobs/blog)
FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL
CLICK_HASH_PEPPER       # required by sessionCookie middleware
```
Recommended:
```
PORT=5002
TRUST_PROXY=1           # proxy hop count (number) or boolean string
ALLOWED_ORIGINS=        # comma-separated; built-in defaults: careersat.tech, www, localhost:3000, *.vercel.app
ADMIN_API_KEY=          # legacy auth fallback
ADMIN_SECRET=           # scraper admin routes
FIREBASE_REQUIRE_ADMIN_CLAIM=true   # require custom admin claim on Firebase tokens
```
Optional:
```
CLOUD_NAME2, API_KEY2, API_SECRET2               # Cloudinary (ads)
FIREBASE_PRIVATE_KEY_ID, FIREBASE_CLIENT_ID
LOG_LEVEL=info

# Scraper
AI_PROVIDER=groq        # groq | gemini | claude | openrouter (default groq)
GEMINI_API_KEY, GROQ_API_KEY, GROQ_MODEL, CLAUDE_API_KEY, CLAUDE_MODEL,
OPENROUTER_API_KEY, OPENROUTER_MODEL
SCRAPERAPI_KEY_1, SCRAPERAPI_KEY_2, SCRAPERAPI_KEY_3   # rotated fetch proxy keys
MAX_SCRAPE_HTML_BYTES   # cap on fetched HTML size (default 5 MB)
TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

# Apply-link verifier
VERIFY_JOBS_ENABLED=true     # gate the cron (off by default)
VERIFY_JOBS_CRON=0 3 */3 * * # schedule (default every 3 days, 3 AM)
VERIFY_JOBS_TZ=Asia/Kolkata
VERIFY_JOBS_CONCURRENCY=5
VERIFY_JOBS_DRY_RUN=true      # log, don't write
RESEND_API_KEY, VERIFY_EMAIL_TO, VERIFY_EMAIL_FROM   # summary email

# Blog
BLOG_CLOUDINARY_FOLDER=blog
NEXT_REVALIDATION_URL (or SITE_REVALIDATE_URL), REVALIDATE_SECRET
SITE_URL, SITE_TITLE, SITE_DESCRIPTION   # RSS feed

NODE_ENV=production     # gates secure cookie flag
```
Config file (gitignored): `.env`. See `.env.example`.

## Schedulers (init'd by `server.js` after `listen`)
- `src/jobs/scraper.scheduler.js` — main `30 12 * * *` (6 PM IST) full pipeline
  (Telegram alert after consecutive failures); **peerlist** on its own
  `0 9 * * *` (09:00 UTC).
- `src/jobs/blog.scheduler.js` — `* * * * *`: flips `scheduled → published` when
  `scheduledFor <= now`, triggers revalidation.
- `src/jobs/verifyJobs.scheduler.js` — default `0 3 */3 * *`, **only if
  `VERIFY_JOBS_ENABLED=true`**; p-limit concurrency + per-domain throttle,
  `bulkWrite` of verification results, optional Resend summary.

## Security Checklist (before every PR)
- [ ] Input sanitised (regex via `escapeRegex`) and validated (Zod for v2/blog/admin)
- [ ] Auth on all write/admin routes (`requireAuth` or `requireAdminSecret`)
- [ ] No sensitive data (tokens, raw DB errors, env values) in logs or responses
- [ ] Field allowlist on update/add/approve (no `Object.assign(doc, req.body)`)
- [ ] **Any outbound fetch of a non-trusted URL goes through the SSRF guard**
      (`isPublicHttp(s)Url` + `guardedAxiosAgents`); redirects re-validated
- [ ] Any new redirect/`res.redirect` validates the target scheme
- [ ] CORS origins reviewed if `ALLOWED_ORIGINS` changes
- [ ] Rate limits still apply to any new `/api/*` route
- [ ] `validateObjectId` on every `:id` route param
- [ ] No new startup-critical env var without updating `REQUIRED` in `src/config/index.js`
```
