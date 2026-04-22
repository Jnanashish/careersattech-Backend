# 06 — Public Click Tracking (JobV2)

Public (unauthenticated) endpoints that log job impressions/clicks to
`JobClickV2` and bump the denormalized counters on `JobV2.stats`.

## Files

### Model
- [model/jobClickV2.schema.js](../model/jobClickV2.schema.js)
  — `JobClickV2`, collection `job_clicks_v2`.
  - Event types: `impression`, `detail_view`, `apply_click`, `external_redirect`.
  - Indexes: `{ job, timestamp:-1 }`, `{ eventType, timestamp:-1 }`, and a TTL
    index on `{ timestamp: 1 }` with `expireAfterSeconds = 180 * 86400` —
    **MongoDB auto-deletes click events 180 days after `timestamp`**.

### Middleware
- [middleware/sessionCookie.js](../middleware/sessionCookie.js) — adds both
  `req.sessionHash` and `req.ipHash` for downstream handlers.
  - Reads the `cat_sess` cookie. If missing, mints a fresh ID via
    `nanoid(21)` and sets it on the response with:
    - `maxAge = 30 days`, `path = "/"`
    - `httpOnly: false` (client may inspect)
    - `sameSite: "lax"`
    - `secure: true` when `NODE_ENV === "production"` (else `false` so
      local dev over http works).
  - Computes `ipHash = sha256(req.ip + CLICK_HASH_PEPPER)`. **Throws on
    module require** if `CLICK_HASH_PEPPER` is not set — this will fail
    startup as required.
  - Cookie header parsing is done inline (no `cookie-parser` dep; Express
    `res.cookie()` is built-in and works without it).
  - `req.ip` respects `app.set("trust proxy", 1)` which is already set in
    [app.js:23](../app.js), so hashes derive from the real client IP
    behind the proxy, not the load balancer.

### Controllers + routes (public, no auth)
- [controllers/public/jobsV2.controllers.js](../controllers/public/jobsV2.controllers.js)
  — `applyRedirect`, `logView`. Writes to `JobClickV2` and the `$inc` on
  `JobV2.stats` are **fire-and-forget**: not awaited, errors logged via
  `console.error` so an unhandled rejection can't crash the process.
- [routes/public/jobsV2.routes.js](../routes/public/jobsV2.routes.js):

| Method | Path | Handler | Stat bumped |
|---|---|---|---|
| `GET`  | `/api/jobs/:slug/apply` | `applyRedirect` → 302 to `job.applyLink` | `stats.applyClicks` |
| `POST` | `/api/jobs/:slug/view`  | `logView` → 200 `{ success: true }`      | `stats.pageViews`   |

Both apply `sessionCookie` middleware, both filter `JobV2` with
`{ status: "published", deletedAt: null }`, both return `404 { error: "Job not found" }`
when the slug does not resolve.

### Registration
- Wired in [app.js:38](../app.js) (require) and [app.js:93](../app.js)
  (`app.use("/api", jobsV2PublicRoutes)`). No catch-all 404 handler exists
  in this project (per audit report §9), so there was nothing to place
  this router before — it sits alongside the other `/api` routers.

## Env var

```
CLICK_HASH_PEPPER=<random 32+ byte hex string, e.g. `openssl rand -hex 32`>
```

**TODO**: add a line to `.env.example`:

```
# Click tracking — pepper for SHA-256 IP hashing (required; throws on boot if missing)
CLICK_HASH_PEPPER=
```

Not added automatically to avoid committing a secret placeholder without
review.

## Rate limiting

Both routes inherit the project's existing `/api` rate limiter from
[app.js:69-72](../app.js) — `GET` goes through `readLimiter` (300 req / 15 min / IP)
and `POST` through `writeLimiter` (100 req / 15 min / IP). No per-route
limiter was added; the global prefix limiter already covers both endpoints.

## curl examples

Local dev (cookies persisted with a cookie jar so the second request
reuses the session from the first):

```
# Apply — returns a 302 redirect to job.applyLink (use -i -L to follow)
curl -i -c cookies.txt -b cookies.txt \
  "http://localhost:5002/api/jobs/acme-backend-engineer-aB3xQ9/apply"

# View — POST, empty body or { "referrer": "https://google.com" }
curl -i -c cookies.txt -b cookies.txt \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"referrer":"https://google.com"}' \
  "http://localhost:5002/api/jobs/acme-backend-engineer-aB3xQ9/view"

# Unknown slug → 404
curl -i "http://localhost:5002/api/jobs/does-not-exist/view" -X POST
```

After the first request, `cookies.txt` will contain `cat_sess=<21-char-nanoid>`
with a 30-day expiry.

## Retention

The TTL index on `JobClickV2.timestamp` auto-deletes events older than
**180 days**. No manual pruning is required. If retention needs to change,
drop the TTL index in Mongo and recreate with a new `expireAfterSeconds`.

## Deviations from audit report conventions

- New `controllers/public/` and `routes/public/` directories — mirrors the
  existing `controllers/admin/` + `routes/admin/` split introduced for the
  V2 admin routes. No existing "public unauthenticated" folder existed.
- No Zod validator for the `POST /view` body. The body is optional and
  only `referrer: string` is read; applying a validator for a single
  optional string adds more ceremony than it avoids.
- Controllers treat the click-write and counter-bump as fire-and-forget
  (not awaited). This is explicitly requested in the task prompt and
  matches the audit report's note (§9) that fire-and-forget click-event
  inserts already exist in the analytics code path.
