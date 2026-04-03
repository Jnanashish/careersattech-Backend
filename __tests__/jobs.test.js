const request = require("supertest");
const mongoose = require("mongoose");

require("./setup");
const createApp = require("./createApp");
const Jobdesc = require("../model/jobs.schema");
const CompanyLogo = require("../model/company.schema");

// Mock cloudinary so it doesn't make real API calls
jest.mock("cloudinary", () => ({
    v2: {
        config: jest.fn(),
        uploader: {
            upload: jest.fn().mockResolvedValue({ secure_url: "https://cloudinary.com/test.jpg" }),
        },
    },
}));

let app;
const AUTH = { "x-api-key": "test-secret-key" };

beforeAll(() => {
    app = createApp();
});

// Helper to create a company and return its _id
async function createCompany(name = "TestCorp") {
    const company = await CompanyLogo.create({ companyName: name });
    return company;
}

// Helper to create a job
async function createJob(overrides = {}) {
    const defaults = {
        title: "Software Engineer",
        link: "https://example.com/apply",
        companyName: "TestCorp",
        jobtype: "fulltime",
        batch: "2024",
        degree: "B.Tech",
        location: "Bangalore",
        isActive: true,
        priority: 1,
    };
    return Jobdesc.create({ ...defaults, ...overrides });
}

describe("GET /api/jd/get", () => {
    it("should return all jobs when no filters applied", async () => {
        await createJob({ title: "Frontend Dev" });
        await createJob({ title: "Backend Dev" });

        const res = await request(app).get("/api/jd/get");

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(2);
        expect(res.body.totalCount).toBe(2);
    });

    it("should return a single job by id", async () => {
        const job = await createJob({ title: "Specific Job" });

        const res = await request(app).get(`/api/jd/get?id=${job._id}`);

        expect(res.status).toBe(200);
        expect(res.body.data).toBeDefined();
    });

    it("should return 500 for invalid id format", async () => {
        const res = await request(app).get("/api/jd/get?id=invalid-id");

        expect(res.status).toBe(500);
        expect(res.body.error).toBeDefined();
    });

    it("should filter jobs by companyname", async () => {
        await createJob({ title: "Job A", companyName: "Google" });
        await createJob({ title: "Job B", companyName: "Meta" });

        const res = await request(app).get("/api/jd/get?companyname=Google");

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].companyName).toBe("Google");
    });

    it("should filter jobs by batch", async () => {
        await createJob({ title: "Job 2024", batch: "2024" });
        await createJob({ title: "Job 2025", batch: "2025" });

        const res = await request(app).get("/api/jd/get?batch=2024");

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
    });

    it("should filter jobs by degree", async () => {
        await createJob({ title: "Job 1", degree: "B.Tech" });
        await createJob({ title: "Job 2", degree: "MBA" });

        const res = await request(app).get("/api/jd/get?degree=MBA");

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
    });

    it("should filter jobs by jobtype", async () => {
        await createJob({ title: "Intern", jobtype: "intern" });
        await createJob({ title: "Fulltime", jobtype: "fulltime" });

        const res = await request(app).get("/api/jd/get?jobtype=intern");

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
    });

    it("should filter jobs by location", async () => {
        await createJob({ title: "BLR Job", location: "Bangalore" });
        await createJob({ title: "HYD Job", location: "Hyderabad" });

        const res = await request(app).get("/api/jd/get?location=Hyderabad");

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
    });

    it("should search jobs by query (title text search)", async () => {
        await createJob({ title: "React Developer" });
        await createJob({ title: "Java Engineer" });

        const res = await request(app).get("/api/jd/get?query=React");

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].title).toBe("React Developer");
    });

    it("should handle multi-word query with OR logic", async () => {
        await createJob({ title: "React Developer" });
        await createJob({ title: "Java Engineer" });
        await createJob({ title: "Python Developer" });

        const res = await request(app).get("/api/jd/get?query=React Java");

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(2);
    });

    it("should paginate results with page and size", async () => {
        for (let i = 0; i < 5; i++) {
            await createJob({ title: `Job ${i}` });
        }

        const res = await request(app).get("/api/jd/get?page=1&size=2&filterData=0");

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(2);
        expect(res.body.totalCount).toBe(5);
    });

    it("should return second page of results", async () => {
        for (let i = 0; i < 5; i++) {
            await createJob({ title: `Job ${i}` });
        }

        const page1 = await request(app).get("/api/jd/get?page=1&size=3&filterData=0");
        const page2 = await request(app).get("/api/jd/get?page=2&size=3&filterData=0");

        expect(page1.body.data).toHaveLength(3);
        expect(page2.body.data).toHaveLength(2);
    });

    it("should filter inactive jobs when filterData=1 with pagination", async () => {
        await createJob({ title: "Active Job", isActive: true });
        await createJob({ title: "Inactive Job", isActive: false });

        const res = await request(app).get("/api/jd/get?page=1&size=10&filterData=1");

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].title).toBe("Active Job");
    });

    it("should sort by priority when priority param is present", async () => {
        await createJob({ title: "Low Priority", priority: 1 });
        await createJob({ title: "High Priority", priority: 10 });

        const res = await request(app).get("/api/jd/get?priority=1");

        expect(res.status).toBe(200);
        expect(res.body.data[0].title).toBe("High Priority");
    });

    it("should populate company details in job response", async () => {
        const company = await createCompany("PopulatedCorp");
        await createJob({ title: "Populated Job", company: company._id });

        const res = await request(app).get("/api/jd/get");

        expect(res.status).toBe(200);
        expect(res.body.data[0].company).toBeDefined();
        expect(res.body.data[0].company.companyName).toBe("PopulatedCorp");
    });

    it("should cap page size at 100", async () => {
        for (let i = 0; i < 5; i++) {
            await createJob({ title: `Job ${i}` });
        }

        const res = await request(app).get("/api/jd/get?page=1&size=200&filterData=0");

        expect(res.status).toBe(200);
        // size is capped at 100, but only 5 exist
        expect(res.body.data).toHaveLength(5);
    });

    it("should filter by jobId", async () => {
        await createJob({ title: "Job A", jobId: "JOB-001" });
        await createJob({ title: "Job B", jobId: "JOB-002" });

        const res = await request(app).get("/api/jd/get?jobId=JOB-001");

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
    });
});

describe("POST /api/jd/add", () => {
    it("should add a new job", async () => {
        const res = await request(app).post("/api/jd/add").set(AUTH).send({
            title: "New Job",
            link: "https://example.com/job",
            companyName: "TestCorp",
            jobtype: "fulltime",
        });

        expect(res.status).toBe(201);
        expect(res.body.message).toBe("Data added successfully");

        const jobs = await Jobdesc.find({});
        expect(jobs).toHaveLength(1);
        expect(jobs[0].title).toBe("New Job");
    });

    it("should parse comma-separated tags into array", async () => {
        await request(app).post("/api/jd/add").set(AUTH).send({
            title: "Tagged Job",
            link: "https://example.com/job",
            tags: "react,node,mongodb",
        });

        const job = await Jobdesc.findOne({ title: "Tagged Job" });
        expect(job.tags).toEqual(["react", "node", "mongodb"]);
    });

    it("should link job to company via companyId", async () => {
        const company = await createCompany("LinkedCorp");

        await request(app).post("/api/jd/add").set(AUTH).send({
            title: "Linked Job",
            link: "https://example.com/job",
            companyId: company._id.toString(),
        });

        const updatedCompany = await CompanyLogo.findById(company._id);
        expect(updatedCompany.listedJobs).toHaveLength(1);
    });

    it("should fail when required fields are missing", async () => {
        const res = await request(app).post("/api/jd/add").set(AUTH).send({
            companyName: "NoCriticalFields",
        });

        expect(res.status).toBe(500);
    });

    it("should set default values correctly", async () => {
        await request(app).post("/api/jd/add").set(AUTH).send({
            title: "Defaults Job",
            link: "https://example.com",
        });

        const job = await Jobdesc.findOne({ title: "Defaults Job" });
        expect(job.isActive).toBe(true);
        expect(job.totalclick).toBe(0);
        expect(job.platform).toBe("careerspage");
        expect(job.workMode).toBe("onsite");
        expect(job.isFeaturedJob).toBe(false);
        expect(job.priority).toBe(1);
    });
});

describe("PUT /api/jd/update/:id", () => {
    it("should update an existing job", async () => {
        const job = await createJob({ title: "Old Title" });

        const res = await request(app).put(`/api/jd/update/${job._id}`).set(AUTH).send({
            title: "New Title",
        });

        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Successfully Updated");

        const updated = await Jobdesc.findById(job._id);
        expect(updated.title).toBe("New Title");
    });

    it("should return 404 for non-existent job", async () => {
        const fakeId = new mongoose.Types.ObjectId();

        const res = await request(app).put(`/api/jd/update/${fakeId}`).set(AUTH).send({
            title: "Ghost Update",
        });

        expect(res.status).toBe(404);
        expect(res.body.error).toBe("Job not found");
    });

    it("should parse tags on update", async () => {
        const job = await createJob();

        await request(app).put(`/api/jd/update/${job._id}`).set(AUTH).send({
            tags: "python,django",
        });

        const updated = await Jobdesc.findById(job._id);
        expect(updated.tags).toEqual(["python", "django"]);
    });

    it("should link to company when companyId is provided", async () => {
        const job = await createJob();
        const company = await createCompany("UpdateCorp");

        await request(app).put(`/api/jd/update/${job._id}`).set(AUTH).send({
            companyId: company._id.toString(),
        });

        const updated = await Jobdesc.findById(job._id);
        expect(updated.company.toString()).toBe(company._id.toString());

        const updatedCompany = await CompanyLogo.findById(company._id);
        expect(updatedCompany.listedJobs.map((id) => id.toString())).toContain(job._id.toString());
    });

    it("should only update allowed fields", async () => {
        const job = await createJob({ totalclick: 5 });

        await request(app).put(`/api/jd/update/${job._id}`).set(AUTH).send({
            title: "Updated",
            totalclick: 999, // not in allowedFields
        });

        const updated = await Jobdesc.findById(job._id);
        expect(updated.title).toBe("Updated");
        expect(updated.totalclick).toBe(5); // unchanged
    });

    it("should return 400 for invalid id format", async () => {
        const res = await request(app).put("/api/jd/update/not-an-id").set(AUTH).send({
            title: "Bad ID",
        });

        expect(res.status).toBe(400);
    });
});

describe("PATCH /api/jd/update/count/:id", () => {
    it("should increment totalclick by 1", async () => {
        const job = await createJob({ totalclick: 0 });

        const res = await request(app).patch(`/api/jd/update/count/${job._id}`);

        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Clicked");

        const updated = await Jobdesc.findById(job._id);
        expect(updated.totalclick).toBe(1);
    });

    it("should increment multiple times", async () => {
        const job = await createJob({ totalclick: 0 });

        await request(app).patch(`/api/jd/update/count/${job._id}`);
        await request(app).patch(`/api/jd/update/count/${job._id}`);
        await request(app).patch(`/api/jd/update/count/${job._id}`);

        const updated = await Jobdesc.findById(job._id);
        expect(updated.totalclick).toBe(3);
    });

    it("should return 404 for non-existent job", async () => {
        const fakeId = new mongoose.Types.ObjectId();

        const res = await request(app).patch(`/api/jd/update/count/${fakeId}`);

        expect(res.status).toBe(404);
        expect(res.body.error).toBe("Job not found");
    });

    it("should return 400 for invalid id format", async () => {
        const res = await request(app).patch("/api/jd/update/count/not-an-id");

        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Invalid ID format");
    });
});

describe("DELETE /api/jd/delete/:id", () => {
    it("should delete a job by id", async () => {
        const job = await createJob();

        const res = await request(app).delete(`/api/jd/delete/${job._id}`).set(AUTH);

        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Deleted Successfully");

        const deleted = await Jobdesc.findById(job._id);
        expect(deleted).toBeNull();
    });

    it("should remove job from company listedJobs", async () => {
        const company = await createCompany("DeleteCorp");
        const job = await createJob({ company: company._id });
        await CompanyLogo.updateOne({ _id: company._id }, { $push: { listedJobs: job._id } });

        await request(app).delete(`/api/jd/delete/${job._id}`).set(AUTH);

        const updatedCompany = await CompanyLogo.findById(company._id);
        expect(updatedCompany.listedJobs.map((id) => id.toString())).not.toContain(job._id.toString());
    });

    it("should return 404 for non-existent job", async () => {
        const fakeId = new mongoose.Types.ObjectId();

        const res = await request(app).delete(`/api/jd/delete/${fakeId}`).set(AUTH);

        expect(res.status).toBe(404);
        expect(res.body.error).toBe("Job not found");
    });

    it("should handle deleting job with no associated company", async () => {
        const job = await createJob();

        const res = await request(app).delete(`/api/jd/delete/${job._id}`).set(AUTH);

        expect(res.status).toBe(200);
    });

    it("should return 400 for invalid id format", async () => {
        const res = await request(app).delete("/api/jd/delete/not-an-id").set(AUTH);

        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Invalid ID format");
    });
});
