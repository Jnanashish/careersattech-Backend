# Job Apply-URL Verifier — Phase 0 Audit

**Date:** 2026-05-16
**Scope:** Confirm that public-facing endpoints for jobs already exclude
non-`published` jobs (so the auto-archive flow will not regress visible content),
and call out terminology mismatches between the verifier spec and the existing
codebase BEFORE Phase 1 changes are made.

---

## TL;DR

Public read paths for `jobs_v2` already filter `{ status: "published",
deletedAt: null }` everywhere. The verifier moving a job to `status: "archived"`
will immediately remove it from list, detail, slugs, and company-recent-jobs
responses without any additional controller change. **No filter changes were
required.**

The spec uses `'active' | 'archived' | 'closed'` for job lifecycle; the existing
`jobs_v2.status` enum is `draft | published | paused | expired | archived`. We
keep the existing enum and map the spec's "active" → the existing "published".
Auto vs. manual archive is disambiguated by the new `archivedReason` field
(spec'd in Phase 1).

---

## Active code layout (where the audit was performed)

The repo has two parallel layouts; `package.json`'s `start` script runs
`node server.js`, which boots `src/`. The root-level files (`app.js`,
`controllers/`, `routes/`, `model/`) are the legacy layout and remain in tree
because tests import from there. JobV2 / CompanyV2 model definitions exist in
both `model/jobV2.schema.js` and `src/modules/jobsV2/jobsV2.model.js`. They are
identical and register the same `mongoose.models.JobV2` singleton — whichever
file loads first wins. **Schema changes must be applied to both files** so the
test harness and the running server see the same fields.

---

## Endpoints audited

All `jobs_v2` public read paths live under `src/modules/jobsV2/` (mounted at
`/api/jobs/v2/*`) and the redirect/view tracker under `src/modules/jobsV2/jobsV2.public.controller.js`
(mounted at `/api/jobs/:slug/apply` and `/api/jobs/:slug/view`).

| Endpoint | File | Filter | Archived job behavior |
|---|---|---|---|
| `GET /api/jobs/v2` (list) | `jobsV2.publicRead.controller.js` `listJobs` → `buildListFilter` → `publishedJobsFilter()` | `{ status: "published", deletedAt: null, ... }` | Hidden ✅ |
| `GET /api/jobs/v2/:slug` (detail) | `jobsV2.publicRead.controller.js` `getJobBySlug` | `{ status: "published", deletedAt: null }` | **Returns 404 ✅** |
| `GET /api/jobs/v2/slugs` (sitemap source) | `jobsV2.publicRead.controller.js` `listSlugs` | `publishedJobsFilter()` | Hidden ✅ |
| `GET /api/jobs/v2/by-id/:id` (legacy ID resolver) | `jobsV2.publicRead.controller.js` `resolveLegacyId` | Returns 410 if `status !== "published"` or `deletedAt` | Returns 410 ✅ |
| `GET /api/jobs/:slug/apply` (redirect) | `jobsV2.public.controller.js` `applyRedirect` | `{ status: "published", deletedAt: null }` | Returns 404 ✅ |
| `POST /api/jobs/:slug/view` (legacy view log) | `jobsV2.public.controller.js` `logView` | `{ status: "published", deletedAt: null }` | Returns 404 ✅ |
| `POST /api/jobs/v2/:slug/track-view` and `track-apply` | `jobsV2.publicRead.controller.js` `fireAndForgetIncrement` | `{ slug, status: "published", deletedAt: null }` on the `$inc` | No-op ✅ |
| Companies recent-jobs join (`GET /api/companies/v2/:slug`) | `companiesV2.publicRead.controller.js` `getCompanyBySlug` → re-uses `jobsCtrl._internals.publishedJobsFilter` | `{ status: "published", deletedAt: null }` | Excluded from `recentJobs` and `openJobsCount` ✅ |

### Sitemap / RSS

There is no jobs sitemap or jobs RSS endpoint in the backend — the Next.js
frontend generates the jobs sitemap by consuming `GET /api/jobs/v2/slugs`,
which is `publishedJobsFilter()`-gated. Archived jobs will disappear from the
slugs response within the existing 5-minute cache window (`SLUGS_TTL_MS`).
**No backend sitemap change needed.**

The Blog module has its own `/api/blogs/sitemap` and `/api/blogs/rss` but
those are unrelated to jobs and out of scope here.

---

## Single-job-detail behavior decision

Spec offered three options for an archived job at the detail endpoint:

1. **Recommended:** 200 OK + past `validThrough` + frontend `noindex`.
2. **Alternative:** 404.
3. **For now:** 404 if frontend metadata is not easily wireable.

**Decision: option 3 (404).** The existing controller already returns 404 for
non-published jobs and that path is well-tested (`jobsV2.public.test.js`,
`jobsV2Public.read.test.js`). Moving to option 1 means a frontend coordination
pass and we can defer that without breaking SEO worse than the current
behavior. Re-visit when the frontend ships a `noindex`-on-archived path.

---

## Open questions resolved during audit

| # | Spec question | Resolution |
|---|---|---|
| 1 | `'archived'` missing from enum? | Already present. Enum stays `draft\|published\|paused\|expired\|archived`. No breaking enum change required. |
| 2 | Public filter relies on `deletedAt: null` vs `status`? | Uses **both** — `{ status: "published", deletedAt: null }`. Verifier sets `status: 'archived'`, which is excluded by the status check; `deletedAt` is left untouched (archive ≠ soft-delete). |
| 3 | Existing email transport to reuse? | None. Repo has Telegram (`scraper/notifier`) only. Adding `resend` is consistent with spec. |
| 4 | `axios` vs `node-fetch`? | `axios@1.14.0` already in dependencies — use it. Do not add `node-fetch`. |

---

## Spec terminology → codebase mapping

| Spec term | Codebase term |
|---|---|
| `status: 'active'` (job eligible to display) | `status: 'published'` |
| `status: 'archived'` | `status: 'archived'` |
| `status: 'closed'` (manual, never auto-verified) | No direct equivalent — `paused` and `expired` cover similar admin-driven states. **Verifier only ever flips `published → archived`**, so manual `paused`/`expired`/`closed` flows are not affected. |
| Default status `'active'` (spec) | Default status `'draft'` (codebase, set at create time). The verifier's job-selection query (`status: 'published'`) is the moral equivalent of "default to active". |

The verifier query at Phase 3 will use:

```js
JobV2.find({
  status: "published",
  deletedAt: null,
  applyLink: { $exists: true, $nin: [null, ""] },
}).sort({ "verification.lastCheckedAt": 1 });
```

…instead of the spec's `status: 'active'`.

---

## Changes made during Phase 0

**None.** Audit was read-only. The existing filter is correct.

---

## Action items carried into Phase 1+

- [ ] Add `verification` subdoc, `archivedAt`, `archivedReason` to **both**
      `model/jobV2.schema.js` and `src/modules/jobsV2/jobsV2.model.js`.
- [ ] Add compound index `{ status: 1, "verification.lastCheckedAt": 1 }`.
- [ ] Idempotent migration script under `scripts/migrations/`.
- [ ] When the auto-archive cron flips a job to `archived`, also set
      `archivedReason = 'auto-verification-expired'` so admins can filter
      manual vs automatic archives.
