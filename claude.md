# CareersAt.Tech Backend

## Project Overview
Backend API for careersattech.tech — an Indian tech job portal for freshers.
Serves job listings, company profiles, filtering/pagination, and an experimental ad system.

## Stack
- Runtime: Node.js
- Framework: Express.js v4.17.1
- Database: MongoDB (Mongoose v6 ODM)
- Image Storage: Cloudinary (dual accounts — one for jobs, one for ads)
- Auth: None (open API, no auth middleware)

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
