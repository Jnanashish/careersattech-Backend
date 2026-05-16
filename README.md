# CareersAt.Tech Backend

Backend API for careersattech.tech. Full project conventions, schema notes,
auth model, and route reference are in `CLAUDE.md` and `API_DOCS.md`.

## Cron Jobs

The server registers three background cron schedulers on startup
(`server.js` → `src/jobs/*`):

| Cron | Schedule | What it does | Source |
|---|---|---|---|
| Scraper | `30 12 * * *` (6 PM IST daily) | Runs AI scrape adapters, ingests into `StagingJob`. | `src/jobs/scraper.scheduler.js` |
| Blog publisher | `* * * * *` (every minute) | Flips `scheduled → published` when `scheduledFor ≤ now`; fires Next.js revalidation. | `src/jobs/blog.scheduler.js` |
| **Job apply-URL verifier** | `VERIFY_JOBS_CRON` (default `0 3 */3 * *` — every 3 days at 03:00) | Fetches each published job's `applyLink`, classifies the response, auto-archives jobs whose pages indicate the listing is closed, emails the founder a summary. | `src/jobs/verifyJobs.scheduler.js` |

### Job apply-URL verifier

**What it does**
- Selects `JobV2` documents where `status === 'published'`, `deletedAt === null`,
  and `applyLink` is set. Oldest `verification.lastCheckedAt` first, so a mid-run
  restart resumes where it left off.
- Fetches each URL with `axios` (10 s timeout, up to 5 redirects, browser-like
  `User-Agent`).
- Classifies the response into one of three buckets:
  - `expired` — HTTP 404/410, body matches a phrase in
    `src/services/jobVerifier/expiredPhrases.js`, or the final URL collapsed
    onto a `/careers` / `/jobs` homepage. **Auto-archives the job**
    (`status = 'archived'`, `archivedAt = now`,
    `archivedReason = 'auto-verification-expired'`).
  - `active` — page loaded normally, no expired markers. Updates audit fields,
    resets `verification.consecutiveInconclusive`.
  - `inconclusive` — timeout, DNS / TLS error, HTTP 5xx, CAPTCHA / Cloudflare
    wall, or empty body. **Never archives.** Increments
    `verification.consecutiveInconclusive`.
- All updates are written as a single `bulkWrite` at the end of the run
  (saves Atlas round-trips). Concurrency is capped at `VERIFY_JOBS_CONCURRENCY`
  (default 5) and a 2-second per-hostname throttle is enforced.
- Sends an HTML + plain-text summary email via Resend regardless of how many
  jobs were processed (heartbeat semantics).

**Public listings are unaffected** — every public `jobs_v2` read path already
filters `{ status: 'published', deletedAt: null }`, so an archived job is
removed from list, detail, slugs, sitemap inputs, and company-recent-jobs in
the same request after the verifier flips it. Audit is in
`migration/job-verifier-audit.md`.

**What it never does** — delete records. Archive only. Manual deletion is the
admin panel's job.

### Environment variables

```
# Toggle and schedule
VERIFY_JOBS_ENABLED=false            # set to "true" to wire the cron at boot
VERIFY_JOBS_CRON=0 3 */3 * *         # node-cron expression
VERIFY_JOBS_CONCURRENCY=5            # max parallel HTTP fetches
VERIFY_JOBS_DRY_RUN=false            # "true" → no DB writes; email subject prefixed [DRY RUN]

# Email summary (Resend)
RESEND_API_KEY=
VERIFY_EMAIL_FROM=onboarding@resend.dev
VERIFY_EMAIL_TO=
```

If `RESEND_API_KEY` or `VERIFY_EMAIL_TO` is missing, the run still completes
and the email is silently skipped with a warning log.

### CLI

A standalone runner uses the same code path as the cron and is handy for
on-phone / Termius runs:

```bash
# full live run (writes to DB, sends email)
node scripts/verifyJobs.js

# dry run — no DB writes
node scripts/verifyJobs.js --dry-run

# dry run, no email either
node scripts/verifyJobs.js --dry-run --no-email

# limit to N oldest-checked jobs
node scripts/verifyJobs.js --limit=10

# check a single job by ObjectId
node scripts/verifyJobs.js --jobId=652fbb...

# check a single job by slug
node scripts/verifyJobs.js --slug=acme-frontend-engineer-xyz
```

### Migration

After deploying the schema change, backfill the new fields on existing jobs:

```bash
node scripts/migrations/addVerificationFields.js
```

The script is idempotent — safe to re-run.

### Operational notes

- A job that appears 3+ runs in a row as `inconclusive`
  (`verification.consecutiveInconclusive >= 3`) is flagged in the email and
  warrants manual review — likely a CAPTCHA wall or a flaky host.
- The verifier never re-opens a job. Once `status = 'archived'`, it is filtered
  out of subsequent runs.
- `verification.lastCheckResult` distinguishes the three buckets even after a
  bulk-archive run, useful for audit dashboards.
