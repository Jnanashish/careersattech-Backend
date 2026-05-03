# Backend v2 public endpoints — production verification

Verified: 2026-05-03
Commit: `9f99746`
Base URL: `https://careersattech-backend-production.up.railway.app/api`

All 9 spec endpoints are live. Verification curls below were captured against
production after Railway redeploy.

---

## 5.1 List envelope — `GET /api/jobs/v2?limit=2`

```json
{
  "total": 8,
  "page": 1,
  "limit": 2,
  "hasMore": true,
  "totalPages": 4,
  "sample": {
    "slug": "blackrock-frontend-engineer-vice-president-vfzp7m",
    "companyName": "BlackRock",
    "displayMode": "external_redirect",
    "jobDescriptionPresent": false,
    "seoPresent": false
  }
}
```

✓ envelope shape correct, `jobDescription` and `seo` not projected on list.

---

## 5.2 List filtering — `GET /api/jobs/v2?employmentType=INTERN&workMode=remote&limit=5`

```
HTTP 200
{ "data": [], "total": 0, "page": 1, "limit": 5, "totalPages": 0, "hasMore": false }
```

✓ HTTP 200, server-side filter applied (no remote interns currently
published — empty result is correct).

---

## 5.3 Detail with populated company — `GET /api/jobs/v2/<slug>`

```json
{
  "slug": "blackrock-frontend-engineer-vice-president-vfzp7m",
  "companyName": "BlackRock",
  "companyPopulated": true,
  "companySlug": "blackrock-2",
  "isExpired": false,
  "jobDescriptionPresent": true,
  "validThrough": null
}
```

✓ company populated with public-safe fields, `jobDescription` present,
`isExpired` flag set.

---

## 5.4 JSON 404 fallback — `GET /api/jobs/v2/this-slug-does-not-exist-xyz`

```
HTTP 404
{ "error": "not_found", "message": "Job not found" }
```

✓ JSON, not HTML — replaces Express's default error page.

---

## 5.5 Legacy by-id resolver — `GET /api/jobs/v2/by-id/507f1f77bcf86cd799439011`

```
HTTP 410
{ "error": "gone" }
```

✓ As expected. **`jobs_v2` does not preserve old v1 `_id`** — see
"Open question for the frontend" below. This endpoint will return
410 for every input until/unless a v1Id backfill happens.

---

## 5.6 Jobs slugs — `GET /api/jobs/v2/slugs`

```json
{
  "count": 9,
  "sample": [
    "stripe-software-engineer-zqpyg9",
    "stripe-frontend-engineer-intern-zy449n",
    "stripe-data-analyst-ab3dgr"
  ]
}
```

✓ Aggressively cached (5-min in-process LRU + `Cache-Control: s-maxage=300`).

---

## 5.7 Companies list + detail

`GET /api/companies/v2?limit=2`:
```json
{
  "total": 459,
  "sample": { "slug": "3m", "companyName": "3M Company", "openJobs": 0 }
}
```

`GET /api/companies/v2/3m`:
```json
{
  "slug": "3m",
  "companyName": "3M Company",
  "recentJobsCount": 0,
  "openJobsCount": 0
}
```

✓ standard envelope, `recentJobs` array bundled, `stats.openJobsCount`
computed live (not denormalized).

---

## 5.8 Companies slugs — `GET /api/companies/v2/slugs`

```
count: 459
```

✓ Sitemap-ready.

---

## 5.9 Tracking endpoints

```
POST /api/jobs/v2/<slug>/track-view   HTTP 204
POST /api/jobs/v2/<slug>/track-apply  HTTP 204
```

✓ Both fire-and-forget, return 204 silently. Increments
`stats.pageViews` / `stats.applyClicks` async. Per-IP+slug rate
limit (10/min) drops silently into 204 too. Exempt from the
global write limiter so they always 204.

---

## 5.10 CORS preflight from `careersat.tech`

```
HTTP/2 204
access-control-allow-credentials: true
access-control-allow-headers: Content-Type,Authorization,x-api-key,x-admin-secret
access-control-allow-methods: GET,POST,PUT,PATCH,DELETE,OPTIONS
access-control-allow-origin: https://careersat.tech
```

✓ Allowlist also covers `https://www.careersat.tech`,
`*.vercel.app`, and `http://localhost:3000`. Any other origin
gets `Access-Control-Allow-Origin` omitted (CORS denied).

---

## Result

**All 9 endpoints live. All §5 verification probes match expected
outcome.**

---

## Open questions for the frontend

### Q1 — Do v2 jobs preserve old `_id` from v1?

**No.** `model/jobV2.schema.js` has no `v1Id` field. The seeders
and the scraper create fresh `ObjectId`s. Therefore `/api/jobs/v2/by-id/:id`
returns 410 for every input in production. Companies have a `v1Id`
string field (per `migration/scripts/fix-companies-v1Id-index.js`)
but jobs do not.

**Implication for the frontend:** the "old v1 URL → new v2 slug"
301 redirect strategy can't rely on this endpoint. Options:

- Hand-build a v1→v2 mapping table during whatever migration produces
  the v2 jobs.
- Let old job-detail URLs 410 (preferred over 404 — Google de-indexes
  410s permanently).
- Add a `v1Id` field on `JobV2` and backfill it as a follow-up; this
  endpoint is wired to honour it the moment it's populated.

### Q2 — Is `recentJobs` bundling on company detail expensive?

**No.** Single aggregation pipeline (sponsorship-tiered sort, limit 20)
on the `{ company: 1, status: 1 }` index, plus one
`countDocuments` for the live `openJobsCount`. Cheaper than a second
network roundtrip from the frontend. Keep it bundled.
