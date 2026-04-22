# 05 — CompanyV2 Admin API Routes

Admin CRUD endpoints for managing `CompanyV2` records (collection `companies_v2`).

## Files Created

| Path | Purpose |
|------|---------|
| [validators/companyV2.js](../validators/companyV2.js) | Zod schemas (`createCompanyV2Schema`, `updateCompanyV2Schema`, `listCompanyV2QuerySchema`) + `validate` / `validateQuery` middleware, mirroring the JobV2 validator. |
| [controllers/admin/companiesV2.controllers.js](../controllers/admin/companiesV2.controllers.js) | Admin controllers: `createCompanyV2`, `listCompaniesV2`, `getCompanyV2`, `updateCompanyV2`, `deleteCompanyV2`. |
| [routes/admin/companiesV2.routes.js](../routes/admin/companiesV2.routes.js) | Express router registering the five admin endpoints under `/admin/companies/v2`. |

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST   | `/api/admin/companies/v2`     | Create a CompanyV2. If `slug` provided: validates format + uniqueness. If omitted: auto-generates via `generateCompanySlug(companyName)`. Because company slugs have no random suffix, any collision is a real conflict — returns **409** with message `"A company with this slug already exists. Provide a custom slug."`. |
| GET    | `/api/admin/companies/v2`     | Paginated list. Query: `page` (≥1, default 1), `limit` (1–100, default 20), `status` (enum), `search` (case-insensitive `$regex` on `companyName` for fuzzy match — not the text index), `industry`. Filters `deletedAt: null`, sorts `{ companyName: 1 }`. Returns `{ companies, total, page, totalPages }`. |
| GET    | `/api/admin/companies/v2/:id` | Fetch single CompanyV2 by `_id` (validated), excluding soft-deleted. Computes `openJobsCount` via `JobV2.countDocuments({ company: id, status: "published", deletedAt: null })` and merges it into the response. 404 if not found. |
| PATCH  | `/api/admin/companies/v2/:id` | Partial update via `updateCompanyV2Schema`. If body.slug supplied: validated + uniqueness-checked against other docs (`_id: { $ne: id }`). Runs with `{ new: true, runValidators: true }`. 200/404. |
| DELETE | `/api/admin/companies/v2/:id` | Soft delete. **Before archiving**, counts published JobV2 docs referencing this company. If count > 0, returns **409** with `"Cannot archive: {count} active jobs reference this company. Archive or reassign those jobs first."`. Otherwise sets `deletedAt = new Date()` and `status = "archived"`. |

All five endpoints are protected by `requireAuth` from [middleware/auth.js](../middleware/auth.js) — same guard as the JobV2 admin routes (prompt 4), blog admin, and the legacy job/company write routes. `:id` routes additionally run [validateObjectId](../middleware/validateObjectId.js).

Error handling follows the existing convention: controllers `try/catch` and delegate to `apiErrorHandler(err, res)` from [Helpers/controllerHelper.js](../Helpers/controllerHelper.js) for 500s. Validation failures return `400 { error, details[] }` from the shared Zod middleware. Mongo duplicate-key (`err.code === 11000`) on slug is converted to a 409. Logging is `console` (via `apiErrorHandler` → `console.error`), matching the rest of the repo.

## Router Registration

Registered in [app.js](../app.js) alongside the other `/api` routers:

- Require line added immediately after `jobsV2AdminRoutes` (line 37):
  ```js
  const companiesV2AdminRoutes = require("./routes/admin/companiesV2.routes");
  ```
- `app.use` added immediately after the `jobsV2AdminRoutes` mount (line 90):
  ```js
  app.use("/api", companiesV2AdminRoutes);
  ```

The existing `/api` rate-limit middleware (read vs write, see [app.js:68-71](../app.js)) covers these new routes automatically.

## cURL Examples

Replace `<TOKEN>` with a Firebase ID token or the legacy `ADMIN_API_KEY`. Replace `<COMPANY_ID>` with a real ObjectId.

### 1. Create a CompanyV2 (auto-slug)

```bash
curl -X POST http://localhost:5002/api/admin/companies/v2 \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "Acme Corp",
    "companyType": "product",
    "industry": "SaaS",
    "headquarters": "Bangalore, IN",
    "website": "https://acme.com",
    "status": "active"
  }'
```

### 2. Create a CompanyV2 (custom slug)

```bash
curl -X POST http://localhost:5002/api/admin/companies/v2 \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "Acme Corporation",
    "slug": "acme-india",
    "companyType": "mnc"
  }'
```

### 3. List CompanyV2 records (paginated, filtered)

```bash
curl -G "http://localhost:5002/api/admin/companies/v2" \
  -H "Authorization: Bearer <TOKEN>" \
  --data-urlencode "page=1" \
  --data-urlencode "limit=20" \
  --data-urlencode "status=active" \
  --data-urlencode "search=acme" \
  --data-urlencode "industry=SaaS"
```

### 4. Fetch a single CompanyV2 by ID (with `openJobsCount`)

```bash
curl -X GET "http://localhost:5002/api/admin/companies/v2/<COMPANY_ID>" \
  -H "Authorization: Bearer <TOKEN>"
```

### 5. Update a CompanyV2 (partial)

```bash
curl -X PATCH "http://localhost:5002/api/admin/companies/v2/<COMPANY_ID>" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "companyType": "unicorn",
    "isVerified": true,
    "headquarters": "Bangalore, IN"
  }'
```

### 6. Soft-delete (archive) a CompanyV2

```bash
curl -X DELETE "http://localhost:5002/api/admin/companies/v2/<COMPANY_ID>" \
  -H "Authorization: Bearer <TOKEN>"
```

If any published JobV2 still references this company, the request returns:

```json
{ "error": "Cannot archive: 3 active jobs reference this company. Archive or reassign those jobs first." }
```
