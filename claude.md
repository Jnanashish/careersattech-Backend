# CareersAt.Tech Backend

## Repo Purpose (for task delegation)
This is the **server-side backend API** for careersattech.tech — an Indian tech job portal for freshers.
Pick this repo for any task involving:

- **Jobs**: CRUD for job listings, filtering, search, pagination, click/apply tracking, featured/priority jobs
- **Companies**: CRUD for company profiles, logos (small/large), career/LinkedIn page links, job-to-company linking
- **Job Scraper**: automated scraping of company career pages via provider/adapter architecture, scheduled via `node-cron`, ingestion and transformation pipeline, admin controls to start/stop/monitor scraper runs
- **Blog system**: markdown-based blog posts with SEO metadata, TOC, cover images (Cloudinary + blurhash), AI-assisted content pipeline (Groq / Google Generative AI), scheduled publishing
- **Analytics**: endpoints that surface traffic / click metrics for jobs and ads
- **Image handling**: Cloudinary uploads (dual accounts — jobs vs ads), `sharp` image processing, blurhash generation
- **Auth & security**: Firebase Admin token verification for admin routes, API-key/bearer auth for write endpoints, Helmet, rate limiting, CORS allowlist, input validation with Zod
- **API docs** (`API_DOCS.md`) — keep in sync when routes change

Do **NOT** pick this repo for:
- Frontend / UI work (Next.js / React site lives in a separate repo)
- Mobile app work
- Anything unrelated to the careersattech.tech job portal backend

## Stack
- Runtime: Node.js (>=18)
- Framework: Express.js v4.21
- Database: MongoDB (Mongoose v8 ODM), `mongodb-memory-server` for tests
- Image Storage: Cloudinary (dual accounts — one for jobs, one for ads)
- Auth: Firebase Admin (admin routes) + API key / bearer token (write endpoints); GET endpoints are public
- Scheduling: `node-cron` (scraper + blog publisher)
- AI: `@google/generative-ai`, `groq-sdk` (used in blog content pipeline)
- Validation: Zod
- Markdown → HTML: `unified` + `remark` + `rehype` toolchain
- Testing: Jest + Supertest

## Project Structure
```
careersattech-Backend/
├── app.js                      # Entry point, Express setup, port 5002
├── DB/connection.js            # Mongoose connection
├── routes/
│   ├── jobs.routes.js          # /api/jd/* routes
│   └── company.routes.js       # /api/companydetails/* routes
├── controllers/
│   ├── jobs.controllers.js     # Job CRUD + click tracking
│   ├── company.controllers.js  # Company CRUD
│   └── common.js               # getPosterLink (Cloudinary upload)
├── model/
│   ├── jobs.schema.js          # Jobdesc model
│   └── company.schema.js       # CompanyLogo model
├── Helpers/
│   └── controllerHelper.js     # apiErrorHandler, filterData, jobDetailsHandler
├── Data/
│   └── companycareerpage.json  # Static list of 100+ company career page URLs
└── Temp/                       # Experimental ad system (unused in prod)
    ├── ad.model.js             # AdPoster, AdLink, AdLinkImg, ShowAdPop schemas
    └── ad.controller.js        # Ad CRUD controllers
```

## Key Commands
- `npm start` — start production server (`node app.js`)
- `npm run dev` — start dev server with nodemon (`nodemon app.js`)

## API Routes

### Jobs — `/api`
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/jd/get` | Fetch jobs with filtering + pagination |
| POST | `/jd/add` | Add new job (supports file upload) |
| PUT | `/jd/update/:id` | Update job by ID |
| PATCH | `/jd/update/count/:id` | Increment apply-click counter |
| DELETE | `/jd/delete/:id` | Delete job, unlinks from company |
| POST | `/jd/getposterlink` | Upload image to Cloudinary, return URL |

### Companies — `/api`
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/companydetails/add` | Create company |
| GET | `/companydetails/get` | Fetch companies (by id or name regex) |
| GET | `/companydetails/logo` | Fetch logo fields only |
| PUT | `/companydetails/update/:id` | Update company |
| DELETE | `/companydetails/delete/:id` | Delete company |

### GET /jd/get query params
- `page`, `size` — pagination
- `query` — title text search (multi-word OR logic)
- `companyname`, `batch`, `degree`, `jobtype`, `location`, `jobId`
- `priority` — sort by priority field (high priority first)
- `filterData` — show only active jobs
- `id` — single job by ObjectId

## Data Models

### Jobdesc (jobs.schema.js)
Key fields: `title`, `companyName`, `company` (ref CompanyLogo), `jobtype`, `role`, `salary`, `salaryRange`, `batch`, `degree`, `experience`, `location`, `workMode` (onsite/hybrid/remote), `skills`, `skilltags`, `tags`, `link`, `lastdate`, `isActive`, `isFeaturedJob`, `priority`, `totalclick`, `adclick`, `imagePath`, `jdbanner`, `platform`

### CompanyLogo (company.schema.js)
Key fields: `companyName`, `smallLogo`, `largeLogo`, `companyInfo`, `listedJobs` (refs to Jobdesc), `companyType`, `careerPageLink`, `linkedinPageLink`, `isPromoted`

## Conventions
- All API responses use `{ success, data, error }` shape (via `apiErrorHandler` / `jobDetailsHandler`)
- Tags are parsed from comma-separated string in requests into arrays
- `filterData()` in Helpers strips sensitive/unnecessary fields before returning to client
- Job add/delete syncs bidirectionally with company's `listedJobs` array
- Click tracking via `totalclick` (apply button) and `adclick` (ad clicks) — incremented via PATCH

## Environment Variables
```
DATABASE=        # MongoDB connection string
PORT=            # Server port (default: 5002)
CLOUD_NAME=      # Cloudinary cloud name (jobs)
API_KEY=         # Cloudinary API key (jobs)
API_SECRET=      # Cloudinary API secret (jobs)
CLOUD_NAME2=     # Cloudinary cloud name (ads)
API_KEY2=        # Cloudinary API key (ads)
API_SECRET2=     # Cloudinary API secret (ads)
```
Config file (gitignored): `config.env` or `.env`

## Security Checklist (before every PR)
- [ ] Input sanitized and validated
- [ ] No sensitive data in logs or API responses
- [ ] Raw DB errors not exposed to clients
- [ ] CORS origins reviewed if changed
