# Admin Panel — Company Management Page

## Overview
Build a **Company Management** page for the CareersAtTech admin panel. This page allows admins to browse, search, add, edit, and delete companies via the backend REST API.

---

## Backend API Reference

**Base URL:** `{{API_BASE_URL}}/api`
**Auth:** All write operations require Firebase auth token in `Authorization: Bearer <token>` header.

### Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/companydetails/get` | No | List companies (paginated) |
| GET | `/companydetails/get?id={id}` | No | Get single company by ID |
| GET | `/companydetails/get?search={term}` | No | Search companies by name |
| GET | `/companydetails/logo?companyname={name}` | No | Get company logo by name |
| POST | `/companydetails/add` | Yes | Create a new company |
| PUT | `/companydetails/update/{id}` | Yes | Update a company |
| DELETE | `/companydetails/delete/{id}` | Yes | Delete a company |

### List/Search Query Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | 1 | Page number (1-based) |
| `limit` | number | 20 | Items per page (max 100) |
| `search` | string | — | Case-insensitive company name search |
| `companyname` | string | — | Case-insensitive partial match on company name |
| `id` | string | — | Fetch single company by MongoDB ObjectId |

### List Response Shape

```json
{
  "data": [
    {
      "_id": "664a...",
      "companyName": "Google",
      "smallLogo": "https://res.cloudinary.com/.../google-icon.png",
      "largeLogo": "https://res.cloudinary.com/.../google-banner.png",
      "companyInfo": "Google is a technology company...",
      "companyType": "productbased",
      "careerPageLink": "https://careers.google.com",
      "linkedinPageLink": "https://linkedin.com/company/google",
      "isPromoted": false,
      "listedJobs": [ { ...jobObject } ]
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 24,
    "totalCount": 466,
    "pageSize": 20
  }
}
```

### Company Schema Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `companyName` | string | Yes | Company display name |
| `smallLogo` | string | No | URL — small icon/logo |
| `largeLogo` | string | No | URL — large banner logo |
| `companyInfo` | string | No | Short description / about text |
| `companyType` | string | No | Category — default `"productbased"` |
| `careerPageLink` | string | No | Careers page URL |
| `linkedinPageLink` | string | No | LinkedIn company page URL |
| `isPromoted` | boolean | No | Whether company is promoted — default `false` |
| `listedJobs` | array | Auto | Populated job references (read-only) |

---

## UI Requirements

### 1. Company List View (Default Page)

**Layout:** Table/card grid with top toolbar.

**Toolbar:**
- **Search bar** — debounced input (300ms) that calls `GET /companydetails/get?search={term}&page=1&limit=20`. Placeholder: "Search companies by name..."
- **Add Company** button — opens the Add/Edit modal in create mode
- **Refresh** button — re-fetches current page

**Table Columns:**

| Column | Source | Notes |
|--------|--------|-------|
| Logo | `smallLogo` | Render as 40x40 image, fallback to initials avatar |
| Company Name | `companyName` | Clickable — opens edit modal |
| Type | `companyType` | Chip/badge (`productbased`, `servicebased`, etc.) |
| Jobs | `listedJobs.length` | Count of linked jobs |
| Promoted | `isPromoted` | Toggle switch or badge |
| Career Page | `careerPageLink` | External link icon, opens in new tab |
| Actions | — | Edit (pencil icon), Delete (trash icon) |

**Pagination Controls (below table):**
- Previous / Next buttons (disabled at boundaries)
- Page number display: "Page {currentPage} of {totalPages}"
- Total count: "Showing {start}-{end} of {totalCount} companies"
- Page size selector: dropdown with options [10, 20, 50, 100]
- Changing page size resets to page 1

**Behavior:**
- On mount, fetch page 1 with default limit 20
- When search input changes (debounced), reset to page 1 and fetch with `search` param
- When search is cleared, fetch unfiltered page 1
- Show loading spinner/skeleton while fetching
- Show empty state if no results: "No companies found" with a clear-search action

### 2. Add/Edit Company Modal

**Trigger:** "Add Company" button (create mode) or row Edit button (edit mode).

**Form Fields:**

| Field | Input Type | Validation |
|-------|-----------|------------|
| Company Name | Text input | Required, min 2 chars |
| Small Logo URL | Text input + image preview | Optional, must be valid URL if provided |
| Large Logo URL | Text input + image preview | Optional, must be valid URL if provided |
| Company Info | Textarea (3 rows) | Optional, max 500 chars |
| Company Type | Dropdown | Options: `productbased`, `servicebased`, `startup`, `mnc` |
| Career Page Link | URL input | Optional, must be valid URL if provided |
| LinkedIn Page Link | URL input | Optional, must be valid URL if provided |
| Is Promoted | Toggle/checkbox | Default off |

**Behavior:**
- **Create mode:** Submit calls `POST /companydetails/add` with form data. On success, close modal, show success toast, refresh list from page 1.
- **Edit mode:** Pre-fill form with existing company data. Submit calls `PUT /companydetails/update/{id}`. On success, close modal, show success toast, refresh current page.
- Show inline validation errors on blur
- Disable submit button while request is in flight
- Show error toast if API call fails

### 3. Delete Confirmation

**Trigger:** Trash icon on a table row.

**Dialog:**
- Title: "Delete Company"
- Message: "Are you sure you want to delete **{companyName}**? This action cannot be undone."
- Buttons: "Cancel" (secondary) | "Delete" (destructive/red)

**Behavior:**
- Calls `DELETE /companydetails/delete/{id}`
- On success, show success toast, refresh current page
- If the current page becomes empty after deletion, go to previous page

---

## State Management

```js
companyState = {
  companies: [],          // current page data
  pagination: {
    currentPage: 1,
    totalPages: 0,
    totalCount: 0,
    pageSize: 20,
  },
  searchQuery: "",         // current search term
  isLoading: false,
  error: null,
}
```

### Key fetch function
```js
async function fetchCompanies({ page = 1, limit = 20, search = "" }) {
  const params = new URLSearchParams({ page, limit });
  if (search.trim()) params.append("search", search.trim());

  const res = await fetch(`${API_BASE_URL}/api/companydetails/get?${params}`, {
    headers: { "Content-Type": "application/json" },
  });
  return res.json(); // { data, pagination }
}
```

---

## Edge Cases to Handle

1. **Search with no results** — show empty state, don't show pagination
2. **Network error** — show error banner with retry button
3. **Concurrent requests** — cancel/ignore stale requests when a new search or page change fires (use AbortController)
4. **Logo URLs broken** — show fallback initials avatar (first letter of company name)
5. **Long company names** — truncate with ellipsis in table, show full name in tooltip
6. **Deleting last item on a page** — navigate to previous page automatically
7. **Rapid pagination clicks** — debounce or disable buttons while loading
