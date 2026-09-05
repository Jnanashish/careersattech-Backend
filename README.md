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
| **Job apply-URL verifier** | `VERIFY_JOBS_CRON` (default `0 */12 * * *` — every 12 hours, 00:00 and 12:00 IST) | Archives jobs past `validThrough`, then fetches each published job's `applyLink` and **hard-deletes** the ones whose pages confirm the listing is closed. Emails the founder a summary and posts the deleted count to the "Cleanup — Jobs Directory" Telegram channel. | `src/jobs/verifyJobs.scheduler.js` |

### Job apply-URL verifier

**What it does**
- Selects `JobV2` documents where `status === 'published'`, `deletedAt === null`,
  and `applyLink` is set. Oldest `verification.lastCheckedAt` first, so a mid-run
  restart resumes where it left off.
- Fetches each URL with `axios` (10 s timeout, up to 5 redirects, browser-like
  `User-Agent`).
- Classifies the response into one of two buckets:
  - `expired` — HTTP 404/410, body matches a phrase in
    `src/services/jobVerifier/expiredPhrases.js`, or the final URL collapsed
    onto a `/careers` / `/jobs` homepage. What happens next depends on who
    started the run (see **Archive vs delete** below): the cron **hard-deletes
    the job**, everything else **archives** it (`status = 'archived'`,
    `archivedAt = now`, `archivedReason = 'auto-verification-expired'`).
  - `active` — anything the verifier can't confirm dead: page loaded normally
    with no expired markers, **or** a transient failure (timeout, DNS / TLS
    error, HTTP 5xx, CAPTCHA / Cloudflare wall, empty body). Updates audit
    fields. **Never archived and never deleted** — only a confirmed-dead link
    is acted on, so a flaky fetch never nukes a good job.
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

**Archive vs delete** — `runVerification({ deleteExpired: true })` removes
confirmed-expired jobs from Mongo outright, along with their `JobClickV2`
events. This is **irreversible** and there is no restore path, so it is opt-in
and exactly one caller opts in: the 12-hourly cron.

| Caller | On `expired` |
|---|---|
| Cron (`init()` → `deleteExpired: true`) | **Hard delete** — job + click events removed |
| Admin panel "Scan apply links" (`POST /verify-now`) | Archive into the flagged review queue |
| CLI `node scripts/verifyJobs.js` | Archive |

Two guards stand between a bad classification and data loss: only the three
definite signals above produce `expired` (a timeout or 5xx never can), and
`VERIFY_JOBS_DRY_RUN=true` suppresses the delete along with every other write
while still reporting what *would* have gone.

**Telegram** — every cron run posts one summary to the `cleanup` channel
(`cleanupChatId` in `src/config/index.js`), headed "🧹 Cleanup — Jobs
Directory": deleted count, links checked, jobs archived by the date sweep,
click events removed, duration, and the first 25 removed titles. Since the
documents are gone, that message is the only remaining record of what was in
them. It also fires when a pass throws, with the error appended.

### Environment variables

```
# Toggle and schedule
VERIFY_JOBS_ENABLED=true             # must be exactly "true" to wire the cron at boot
VERIFY_JOBS_CRON=0 */12 * * *        # node-cron expression (every 12 hours)
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

- Transient failures (timeout, 5xx, CAPTCHA wall, empty body) classify as
  `active` and are never archived. `verification.lastCheckReason` records the
  actual cause (e.g. `timeout`, `captcha-or-bot-wall`) for audit/dashboards.
- The verifier never re-opens a job. Once `status = 'archived'`, it is filtered
  out of subsequent runs.
- `verification.lastCheckResult` distinguishes the two buckets even after a
  bulk-archive run, useful for audit dashboards.
