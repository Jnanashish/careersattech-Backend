# CareersAt.Tech API Documentation

**Base URL:** `https://<your-domain>/api`

**Rate Limit:** 100 requests per 15 minutes per IP

---

## Authentication

All **write endpoints** (POST, PUT, DELETE) require an API key. Pass it via one of:

| Method | Header |
|--------|--------|
| API Key header | `x-api-key: <your-api-key>` |
| Bearer token | `Authorization: Bearer <your-api-key>` |

**Public endpoints** (all GET requests + click tracking PATCH) require no authentication.

**Unauthorized request (401):**

```json
{
  "error": "Unauthorized"
}
```

**Invalid ID format (400):**

All endpoints with `:id` params validate that the ID is a valid MongoDB ObjectId. Invalid IDs return:

```json
{
  "error": "Invalid ID format"
}
```

---

## Jobs

### Get Jobs

Fetch job listings with filtering, search, and pagination.

```
GET /jd/get
```

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | No | Fetch a single job by its MongoDB ObjectId. When provided, all other filters are ignored. |
| `page` | number | No | Page number (starts at 1). Must be used with `size`. |
| `size` | number | No | Items per page (1-100). Must be used with `page`. |
| `query` | string | No | Search by job title. Multi-word queries match if **any** word appears in the title. |
| `companyname` | string | No | Filter by company name (case-insensitive partial match). |
| `batch` | string | No | Filter by batch/year (case-insensitive partial match). |
| `degree` | string | No | Filter by degree (case-insensitive partial match). |
| `jobtype` | string | No | Filter by job type, e.g. `internship`, `fulltime` (case-insensitive partial match). |
| `location` | string | No | Filter by location (case-insensitive partial match). |
| `jobId` | string | No | Filter by external job ID from company careers page. |
| `priority` | any | No | When present, sorts results by priority (highest first), then by newest. |
| `filterData` | `0` \| `1` | No | Default `1`. When `1`, returns only active jobs with a trimmed field set. When `0`, returns all fields. |

**Response (200):**

```json
{
  "totalCount": 150,
  "data": [
    {
      "_id": "665a1b2c3d4e5f6a7b8c9d0e",
      "title": "Software Engineer",
      "link": "https://careers.example.com/apply/123",
      "companyName": "Example Corp",
      "batch": "2024, 2025",
      "degree": "B.Tech, MCA",
      "jobtype": "fulltime",
      "location": "Bangalore",
      "experience": "0-2 years",
      "role": "SDE-1",
      "imagePath": "https://res.cloudinary.com/...",
      "createdAt": "2025-01-15T10:30:00.000Z",
      "totalclick": 42,
      "company": {
        "_id": "665a1b2c3d4e5f6a7b8c9d0f",
        "companyName": "Example Corp",
        "smallLogo": "https://res.cloudinary.com/...",
        "largeLogo": "https://res.cloudinary.com/...",
        "companyInfo": "Leading tech company",
        "companyType": "productbased"
      },
      "isActive": true
    }
  ]
}
```

**When `filterData=0` (unfiltered)**, each job object includes all fields:
`title`, `link`, `jdpage`, `salary`, `batch`, `degree`, `jobdesc`, `eligibility`, `experience`, `lastdate`, `skills`, `location`, `responsibility`, `jobtype`, `imagePath`, `companytype`, `totalclick`, `adclick`, `aboutCompany`, `role`, `jdbanner`, `companyName`, `platform`, `tags`, `skilltags`, `salaryRange`, `workMode`, `isActive`, `jobId`, `isFeaturedJob`, `company`, `benefits`, `priority`, `createdAt`, `updatedAt`

**Examples:**

```
GET /api/jd/get?page=1&size=20
GET /api/jd/get?query=software engineer&location=bangalore&page=1&size=10
GET /api/jd/get?companyname=google&jobtype=internship
GET /api/jd/get?id=665a1b2c3d4e5f6a7b8c9d0e
GET /api/jd/get?priority=1&page=1&size=20
GET /api/jd/get?batch=2025&degree=B.Tech&page=1&size=10&filterData=0
```

---

### Add Job

Create a new job listing. Optionally attach an image via multipart form.

```
POST /jd/add
Content-Type: application/json  OR  multipart/form-data (if uploading image)
x-api-key: <your-api-key>
```

**Authentication:** Required

**Body Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | **Yes** | Job title |
| `link` | string | **Yes** | Application/redirect URL |
| `companyId` | string | No | ObjectId of the company. Links the job to the company's `listedJobs`. |
| `companyName` | string | No | Company name (text) |
| `tags` | string | No | Comma-separated tags, e.g. `"react,node,mongodb"` |
| `jobtype` | string | No | e.g. `fulltime`, `internship` |
| `batch` | string | No | Eligible batches, e.g. `"2024, 2025"` |
| `degree` | string | No | Eligible degrees, e.g. `"B.Tech, MCA"` |
| `location` | string | No | Job location |
| `salary` | string | No | Salary text |
| `salaryRange` | object | No | `{ "from": 500000, "to": 1000000 }` |
| `workMode` | string | No | `onsite`, `hybrid`, or `remote` (default: `onsite`) |
| `experience` | string | No | Required experience |
| `skills` | string | No | Required skills |
| `skilltags` | string[] | No | Array of skill tags |
| `jobdesc` | string | No | Full job description |
| `eligibility` | string | No | Eligibility criteria |
| `responsibility` | string | No | Role responsibilities |
| `lastdate` | string | No | Application deadline |
| `role` | string | No | Role name, e.g. `SDE-1` |
| `platform` | string | No | Redirect platform (default: `careerspage`) |
| `isActive` | boolean | No | Whether job is active (default: `true`) |
| `isFeaturedJob` | boolean | No | Whether job is featured (default: `false`) |
| `priority` | number | No | Display priority, higher = shown first (default: `1`) |
| `benefits` | string | No | Job benefits |
| `jdpage` | boolean | No | Whether the public site should redirect to the in-app JD page (default: `true`). Stringy legacy values like `"true"`/`"false"` are also accepted and coerced. |
| `jdbanner` | string | No | Banner image URL |
| `photo` | file | No | Image file (multipart). Allowed: jpeg, png, webp, svg. Max 5MB. |

**Response (201):**

```json
{
  "message": "Data added successfully"
}
```

**Error (400) — invalid file type:**

```json
{
  "error": "Invalid file type. Allowed: jpeg, png, webp, svg"
}
```

---

### Update Job

Update an existing job by ID.

```
PUT /jd/update/:id
Content-Type: application/json
x-api-key: <your-api-key>
```

**Authentication:** Required

**URL Params:** `id` — MongoDB ObjectId of the job

**Body:** Same fields as Add Job (all optional). Only provided fields are updated. Fields like `totalclick`, `adclick`, `_id`, `createdAt` cannot be overwritten.

**Response (200):**

```json
{
  "message": "Successfully Updated"
}
```

**Error (404):**

```json
{
  "error": "Job not found"
}
```

---

### Track Apply Click

Increment the apply-click counter for a job. Call this each time a user clicks "Apply".

```
PATCH /jd/update/count/:id
```

**URL Params:** `id` — MongoDB ObjectId of the job

**Response (200):**

```json
{
  "message": "Clicked"
}
```

**Error (404):**

```json
{
  "error": "Job not found"
}
```

---

### Delete Job

Delete a job listing by ID. Automatically removes it from the linked company's `listedJobs`.

```
DELETE /jd/delete/:id
x-api-key: <your-api-key>
```

**Authentication:** Required

**URL Params:** `id` — MongoDB ObjectId of the job

**Response (200):**

```json
{
  "message": "Deleted Successfully"
}
```

**Error (404):**

```json
{
  "error": "Job not found"
}
```

---

### Upload Image

Upload an image to Cloudinary and get back the hosted URL. Useful for uploading job banners or logos before creating a job.

```
POST /jd/getposterlink
Content-Type: multipart/form-data
x-api-key: <your-api-key>
```

**Authentication:** Required

**Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `photo` | file | **Yes** | Image file. Allowed: jpeg, png, webp, svg. Max 5MB. |

**Response (201):**

```json
{
  "url": "https://res.cloudinary.com/your-cloud/image/upload/v123/abc.jpg"
}
```

**Error (400):**

```json
{
  "error": "No image file provided"
}
```

```json
{
  "error": "Invalid file type. Allowed: jpeg, png, webp, svg"
}
```

---

## Companies

### Add Company

Create a new company profile.

```
POST /companydetails/add
Content-Type: application/json
x-api-key: <your-api-key>
```

**Authentication:** Required

**Body Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `companyName` | string | **Yes** | Company name |
| `smallLogo` | string | No | URL to small logo/icon |
| `largeLogo` | string | No | URL to large banner logo |
| `companyInfo` | string | No | Company description |
| `companyType` | string | No | e.g. `productbased`, `servicebased`, `startup` (default: `productbased`) |
| `careerPageLink` | string | No | URL to company careers page |
| `linkedinPageLink` | string | No | URL to company LinkedIn page |
| `isPromoted` | boolean | No | Whether company is promoted (default: `false`) |

**Response (200):**

```json
{
  "message": "Data added successfully",
  "id": "665a1b2c3d4e5f6a7b8c9d0f"
}
```

---

### Get Companies

Fetch company details by ID or name. Returns the company with all its linked jobs populated.

```
GET /companydetails/get
```

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | No | Fetch by MongoDB ObjectId. Takes priority over `companyname`. |
| `companyname` | string | No | Search by company name (case-insensitive partial match). Ignored if `id` is provided. |

**Response (200):**

```json
[
  {
    "_id": "665a1b2c3d4e5f6a7b8c9d0f",
    "companyName": "Example Corp",
    "smallLogo": "https://res.cloudinary.com/...",
    "largeLogo": "https://res.cloudinary.com/...",
    "companyInfo": "Leading tech company",
    "companyType": "productbased",
    "careerPageLink": "https://careers.example.com",
    "linkedinPageLink": "https://linkedin.com/company/example",
    "isPromoted": false,
    "listedJobs": [
      {
        "_id": "665a1b2c3d4e5f6a7b8c9d0e",
        "title": "Software Engineer",
        "link": "https://careers.example.com/apply/123"
      }
    ]
  }
]
```

**Examples:**

```
GET /api/companydetails/get?id=665a1b2c3d4e5f6a7b8c9d0f
GET /api/companydetails/get?companyname=google
```

---

### Get Company Logo

Fetch only the logo fields for a company. Lighter response for displaying company cards/thumbnails.

```
GET /companydetails/logo
```

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | No | Fetch by MongoDB ObjectId. Takes priority over `companyname`. |
| `companyname` | string | No | Search by company name (case-insensitive partial match). |

**Response (200):**

```json
{
  "data": {
    "id": "665a1b2c3d4e5f6a7b8c9d0f",
    "smallLogo": "https://res.cloudinary.com/...",
    "largeLogo": "https://res.cloudinary.com/...",
    "companyName": "Example Corp"
  }
}
```

**Error (404):**

```json
{
  "error": "Company not found"
}
```

---

### Update Company

Update company details by ID.

```
PUT /companydetails/update/:id
Content-Type: application/json
x-api-key: <your-api-key>
```

**Authentication:** Required

**URL Params:** `id` — MongoDB ObjectId of the company

**Body:** Any of: `companyName`, `smallLogo`, `largeLogo`, `companyInfo`, `companyType`, `careerPageLink`, `linkedinPageLink`, `isPromoted`. Only provided fields are updated. Internal fields like `listedJobs` and `_id` cannot be overwritten.

**Response (200):**

```json
{
  "message": "Company details updated successfully"
}
```

---

### Delete Company

Delete a company by ID.

```
DELETE /companydetails/delete/:id
x-api-key: <your-api-key>
```

**Authentication:** Required

**URL Params:** `id` — MongoDB ObjectId of the company

**Response (200):**

```json
{
  "message": "Deleted Successfully"
}
```

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "error": "Error message here"
}
```

| Status | Meaning |
|--------|---------|
| `400` | Bad request — missing required fields, invalid file type, or invalid ID format |
| `401` | Unauthorized — missing or invalid API key on a protected endpoint |
| `404` | Resource not found |
| `429` | Rate limit exceeded |
| `500` | Internal server error |

---

## Data Models Reference

### Job Object

| Field | Type | Description |
|-------|------|-------------|
| `_id` | string | Unique identifier |
| `title` | string | Job title |
| `link` | string | Application URL |
| `companyName` | string | Company name |
| `company` | object/string | Populated company object or ObjectId |
| `jobtype` | string | `fulltime`, `internship`, etc. |
| `role` | string | Role name |
| `salary` | string | Salary text |
| `salaryRange` | object | `{ from: number, to: number }` |
| `batch` | string | Eligible batches |
| `degree` | string | Eligible degrees |
| `experience` | string | Required experience |
| `location` | string | Job location |
| `workMode` | string | `onsite`, `hybrid`, or `remote` |
| `skills` | string | Required skills |
| `skilltags` | string[] | Skill tag array |
| `tags` | string[] | General tags |
| `jobdesc` | string | Full description |
| `eligibility` | string | Eligibility criteria |
| `responsibility` | string | Responsibilities |
| `lastdate` | string | Application deadline |
| `platform` | string | Redirect platform |
| `imagePath` | string | Logo/image URL |
| `jdbanner` | string | Banner image URL |
| `isActive` | boolean | Whether job is currently active |
| `isFeaturedJob` | boolean | Whether job is featured |
| `priority` | number | Display priority (higher = first) |
| `totalclick` | number | Total apply clicks |
| `benefits` | string | Job benefits |
| `createdAt` | string | ISO timestamp |
| `updatedAt` | string | ISO timestamp |

### Company Object

| Field | Type | Description |
|-------|------|-------------|
| `_id` | string | Unique identifier |
| `companyName` | string | Company name |
| `smallLogo` | string | Small logo URL |
| `largeLogo` | string | Large banner logo URL |
| `companyInfo` | string | Company description |
| `companyType` | string | `productbased`, `servicebased`, `startup` |
| `careerPageLink` | string | Careers page URL |
| `linkedinPageLink` | string | LinkedIn page URL |
| `isPromoted` | boolean | Whether company is promoted |
| `listedJobs` | array | Array of linked job objects/IDs |

---

## Blog Endpoints

### Authentication

All **admin blog endpoints** (`/api/admin/*`) require authentication via Firebase token or API key (same as other admin endpoints). **Public blog endpoints** (`/api/blogs/*`) require no authentication.

### Public Endpoints

#### List Published Blogs

```
GET /api/blogs?page=1&size=10&category=Career+Tips&tag=react&search=javascript
```

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `size` | number | 20 | Items per page (max 100) |
| `category` | string | — | Filter by category |
| `tag` | string | — | Filter by tag |
| `search` | string | — | Search in title |

**Response (200):**
```json
{
  "data": [
    {
      "_id": "...",
      "title": "Getting Started with React",
      "slug": "getting-started-with-react",
      "excerpt": "A beginner's guide to React...",
      "coverImage": { "url": "...", "alt": "...", "blurhash": "..." },
      "author": { "name": "Admin" },
      "category": "Tech Trends",
      "tags": ["react", "javascript"],
      "publishedAt": "2026-04-08T10:00:00Z",
      "readingTime": 5,
      "views": 42
    }
  ],
  "totalCount": 15,
  "page": 1,
  "size": 10
}
```

**Cache:** `s-maxage=60, stale-while-revalidate=300`

---

#### Get Blog by Slug

```
GET /api/blogs/:slug
```

**Response (200):**
```json
{
  "data": {
    "_id": "...",
    "title": "Getting Started with React",
    "slug": "getting-started-with-react",
    "excerpt": "...",
    "content": "# Getting Started...",
    "contentHtml": "<h1>Getting Started...</h1>...",
    "coverImage": { "url": "...", "alt": "...", "width": 1200, "height": 630, "blurhash": "..." },
    "author": { "name": "Admin", "bio": "...", "avatar": "..." },
    "category": "Tech Trends",
    "tags": ["react"],
    "seo": { "metaTitle": "...", "metaDescription": "..." },
    "tableOfContents": [{ "id": "introduction", "text": "Introduction", "level": 2 }],
    "readingTime": 5,
    "wordCount": 1000,
    "views": 43,
    "publishedAt": "2026-04-08T10:00:00Z",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

**Cache:** `s-maxage=60, stale-while-revalidate=300`. View count is incremented asynchronously.

---

#### Related Blogs

```
GET /api/blogs/related/:slug
```

Returns up to 5 related published posts ranked by tag/category overlap.

**Response (200):**
```json
{ "data": [ { "title": "...", "slug": "...", "excerpt": "...", "coverImage": {...}, ... } ] }
```

---

#### Sitemap Data

```
GET /api/blogs/sitemap
```

Returns all published blog slugs and their last-updated timestamps for sitemap generation.

**Response (200):**
```json
{ "data": [ { "slug": "getting-started-with-react", "updatedAt": "2026-04-08T10:00:00Z" } ] }
```

**Cache:** `s-maxage=3600, stale-while-revalidate=86400`

---

#### RSS Feed

```
GET /api/blogs/rss
```

Returns RSS 2.0 XML feed of the 50 most recent published posts.

**Content-Type:** `application/rss+xml`
**Cache:** `s-maxage=3600, stale-while-revalidate=86400`

---

### Admin Endpoints

All require `Authorization: Bearer <token>` or `x-api-key: <key>`.

#### Create Blog Draft

```
POST /api/admin/blogs
Content-Type: application/json
Authorization: Bearer <token>

{
  "title": "Getting Started with React",
  "content": "# Introduction\n\nReact is a JavaScript library...",
  "category": "Tech Trends",
  "author": { "name": "Admin" },
  "tags": ["react", "javascript"],
  "excerpt": "A beginner's guide to React...",
  "coverImage": { "url": "https://...", "alt": "React logo" },
  "seo": {
    "metaTitle": "React Guide for Beginners",
    "metaDescription": "Learn React from scratch..."
  }
}
```

Required fields: `title`, `content`, `category`, `author.name`

**Response (201):**
```json
{ "message": "Blog draft created", "data": { "_id": "...", "slug": "getting-started-with-react" } }
```

The processing pipeline automatically:
- Generates a unique slug from the title
- Converts markdown to sanitized HTML
- Extracts table of contents from H2/H3 headings
- Calculates word count and reading time
- Re-uploads external images to Cloudinary
- Auto-fills SEO fields if left empty

---

#### List Blogs (Admin)

```
GET /api/admin/blogs?page=1&size=20&status=draft&search=react
```

Returns blogs of any status (draft, published, scheduled, archived). Content body is excluded for performance.

---

#### Get Blog (Admin)

```
GET /api/admin/blogs/:id
```

Returns full blog document including raw markdown `content`.

---

#### Update Blog

```
PATCH /api/admin/blogs/:id
Content-Type: application/json

{ "title": "Updated Title", "tags": ["react", "tutorial"] }
```

Any field from the create schema can be updated. If `content` or `title` changes, the processing pipeline re-runs (HTML, TOC, reading time, slug if title changed).

---

#### Delete (Archive) Blog

```
DELETE /api/admin/blogs/:id
```

Soft-deletes by setting `status: "archived"`. The post is hidden from public endpoints.

**Response (200):**
```json
{ "message": "Blog archived" }
```

---

#### Publish / Schedule Blog

```
POST /api/admin/blogs/:id/publish
Content-Type: application/json

{}
```

Publishes immediately. Sets `publishedAt` on first publish (never overwritten on subsequent publishes).

To schedule for a future date:
```json
{ "scheduledFor": "2026-04-15T10:00:00Z" }
```

A background cron job checks every minute and flips `scheduled → published` when the time arrives.

---

#### Upload Image

```
POST /api/admin/upload
Content-Type: multipart/form-data
Authorization: Bearer <token>

image: <file>
```

Max file size: 5MB. Allowed types: JPEG, PNG, WebP, SVG, GIF. Images are automatically converted to WebP.

**Response (200):**
```json
{
  "url": "https://res.cloudinary.com/..../blog/image.webp",
  "width": 1200,
  "height": 630,
  "blurhash": "LEHV6nWB2yk8pyo0adR*.7kCMdnj"
}
```

---

### Blog Data Model

| Field | Type | Description |
|-------|------|-------------|
| `_id` | string | Unique identifier |
| `title` | string | Blog post title |
| `slug` | string | URL-safe slug (unique) |
| `excerpt` | string | Short description (150-160 chars) |
| `content` | string | Raw markdown |
| `contentHtml` | string | Pre-rendered HTML |
| `coverImage` | object | `{ url, alt, width, height, blurhash }` |
| `author` | object | `{ name, avatar, bio, social }` |
| `category` | string | Blog category |
| `tags` | string[] | Tag list |
| `seo` | object | `{ metaTitle, metaDescription, canonicalUrl, ogImage, keywords, noindex }` |
| `readingTime` | number | Estimated reading time in minutes |
| `wordCount` | number | Word count |
| `tableOfContents` | array | `[{ id, text, level }]` extracted from headings |
| `status` | string | `draft`, `scheduled`, `published`, `archived` |
| `publishedAt` | date | First publish timestamp |
| `scheduledFor` | date | Scheduled publish time |
| `views` | number | View count |
| `createdAt` | date | Auto-generated |
| `updatedAt` | date | Auto-generated |
