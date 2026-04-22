# 04 — JobV2 Admin API Routes

Admin CRUD endpoints for managing `JobV2` records (collection `jobs_v2`).

## Files Created

| Path | Purpose |
|------|---------|
| [validators/jobV2.js](../validators/jobV2.js) | Zod schemas (`createJobV2Schema`, `updateJobV2Schema`, `listJobV2QuerySchema`) + `validate` / `validateQuery` middleware, mirroring the blog validator pattern. |
| [controllers/admin/jobsV2.controllers.js](../controllers/admin/jobsV2.controllers.js) | Admin controllers: `createJobV2`, `listJobsV2`, `getJobV2`, `updateJobV2`, `deleteJobV2`. |
| [routes/admin/jobsV2.routes.js](../routes/admin/jobsV2.routes.js) | Express router registering the five admin endpoints under `/admin/jobs/v2`. |

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST   | `/api/admin/jobs/v2`     | Create a JobV2. Auto-generates slug from `companyName + title` if `slug` is omitted; otherwise validates + uniqueness-checks the provided slug. Up to 5 regeneration attempts on collision; 500 if all fail. 409 on MongoDB duplicate key (code 11000). |
| GET    | `/api/admin/jobs/v2`     | Paginated list. Query: `page` (≥1, default 1), `limit` (1–100, default 20), `status` (enum), `search` (`$text` index), `company` (ObjectId). Filters `deletedAt: null`, sorts `{ createdAt: -1 }`. Returns `{ jobs, total, page, totalPages }`. |
| GET    | `/api/admin/jobs/v2/:id` | Fetch single JobV2 by `_id` (validated), excluding soft-deleted. Populates `company` ref with `companyName slug logo`. 404 if not found. |
| PATCH  | `/api/admin/jobs/v2/:id` | Partial update via `updateJobV2Schema`. If body.slug supplied: validated + uniqueness-checked against other docs (`_id: { $ne: id }`). Slug is immutable unless explicitly provided. Runs with `{ new: true, runValidators: true }`. |
| DELETE | `/api/admin/jobs/v2/:id` | Soft delete: sets `deletedAt = new Date()`, `status = "archived"`. Doc is retained in DB. |

All five endpoints are protected by `requireAuth` from [middleware/auth.js](../middleware/auth.js) — the same middleware that guards existing admin routes (blog admin, job writes, company writes). `:id` routes additionally run [validateObjectId](../middleware/validateObjectId.js).

Error handling follows the existing convention: controllers `try/catch` and delegate to `apiErrorHandler(err, res)` from [Helpers/controllerHelper.js](../Helpers/controllerHelper.js) for 500s. Validation failures return `400 { error, details[] }` from the shared Zod middleware. Logging is `console` (via `apiErrorHandler` → `console.error`), matching the rest of the repo.

## Router Registration

Registered in [app.js](../app.js) alongside the other `/api` routers:

- Require line added after the blog imports (line 36):
  ```js
  const jobsV2AdminRoutes = require("./routes/admin/jobsV2.routes");
  ```
- `app.use` added after `blogAdminRoutes` (line 88):
  ```js
  app.use("/api", jobsV2AdminRoutes);
  ```

The existing `/api` rate-limit middleware (read vs write, see [app.js:67-70](../app.js)) covers these new routes automatically.

## cURL Examples

Replace `<TOKEN>` with a Firebase ID token or the legacy `ADMIN_API_KEY`. Replace `<JOB_ID>` and `<COMPANY_ID>` with real ObjectIds.

### 1. Create a JobV2

```bash
curl -X POST http://localhost:5002/api/admin/jobs/v2 \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Software Engineer I",
    "company": "<COMPANY_ID>",
    "companyName": "Acme Corp",
    "displayMode": "internal",
    "applyLink": "https://acme.com/careers/swe-1",
    "employmentType": ["FULL_TIME"],
    "batch": [2024, 2025],
    "jobDescription": { "html": "<p>Build cool stuff.</p>" },
    "category": "engineering",
    "workMode": "hybrid",
    "requiredSkills": ["javascript", "node.js"],
    "status": "draft"
  }'
```

### 2. List JobV2 records (paginated, filtered)

```bash
curl -G "http://localhost:5002/api/admin/jobs/v2" \
  -H "Authorization: Bearer <TOKEN>" \
  --data-urlencode "page=1" \
  --data-urlencode "limit=20" \
  --data-urlencode "status=draft" \
  --data-urlencode "search=engineer" \
  --data-urlencode "company=<COMPANY_ID>"
```

### 3. Fetch a single JobV2 by ID

```bash
curl -X GET "http://localhost:5002/api/admin/jobs/v2/<JOB_ID>" \
  -H "Authorization: Bearer <TOKEN>"
```

### 4. Update a JobV2 (partial)

```bash
curl -X PATCH "http://localhost:5002/api/admin/jobs/v2/<JOB_ID>" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "published",
    "priority": 5,
    "workMode": "remote"
  }'
```

### 5. Soft-delete a JobV2

```bash
curl -X DELETE "http://localhost:5002/api/admin/jobs/v2/<JOB_ID>" \
  -H "Authorization: Bearer <TOKEN>"
```
