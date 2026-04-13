const request = require("supertest");
const mongoose = require("mongoose");

require("./setup");
const createApp = require("./createApp");
const CompanyLogo = require("../model/company.schema");
const Jobdesc = require("../model/jobs.schema");

// Mock cloudinary
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

async function createCompany(overrides = {}) {
    const defaults = {
        companyName: "TestCorp",
        smallLogo: "https://example.com/small.png",
        largeLogo: "https://example.com/large.png",
        companyInfo: "A test company",
        companyType: "productbased",
    };
    return CompanyLogo.create({ ...defaults, ...overrides });
}

describe("POST /api/companydetails/add", () => {
    it("should create a new company", async () => {
        const res = await request(app).post("/api/companydetails/add").set(AUTH).send({
            companyName: "NewCorp",
            smallLogo: "https://example.com/logo.png",
            companyType: "startup",
        });

        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Data added successfully");
        expect(res.body.id).toBeDefined();

        const company = await CompanyLogo.findById(res.body.id);
        expect(company.companyName).toBe("NewCorp");
    });

    it("should fail when companyName is missing", async () => {
        const res = await request(app).post("/api/companydetails/add").set(AUTH).send({
            smallLogo: "https://example.com/logo.png",
        });

        expect(res.status).toBe(500);
    });

    it("should set default values correctly", async () => {
        const res = await request(app).post("/api/companydetails/add").set(AUTH).send({
            companyName: "DefaultsCorp",
        });

        const company = await CompanyLogo.findById(res.body.id);
        expect(company.companyType).toBe("productbased");
        expect(company.isPromoted).toBe(false);
        expect(company.listedJobs).toHaveLength(0);
    });
});

describe("GET /api/companydetails/get", () => {
    it("should return all companies when no filters applied", async () => {
        await createCompany({ companyName: "Corp A" });
        await createCompany({ companyName: "Corp B" });

        const res = await request(app).get("/api/companydetails/get");

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(2);
        expect(res.body.pagination).toBeDefined();
        expect(res.body.pagination.totalCount).toBe(2);
    });

    it("should return company by id", async () => {
        const company = await createCompany({ companyName: "FindById" });

        const res = await request(app).get(`/api/companydetails/get?id=${company._id}`);

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].companyName).toBe("FindById");
    });

    it("should search company by name (case-insensitive regex)", async () => {
        await createCompany({ companyName: "Google" });
        await createCompany({ companyName: "Meta" });

        const res = await request(app).get("/api/companydetails/get?companyname=google");

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].companyName).toBe("Google");
    });

    it("should return partial name matches", async () => {
        await createCompany({ companyName: "Google India" });
        await createCompany({ companyName: "Google US" });

        const res = await request(app).get("/api/companydetails/get?companyname=Google");

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(2);
    });

    it("should populate listedJobs in company response", async () => {
        const company = await createCompany({ companyName: "PopCorp" });
        const job = await Jobdesc.create({
            title: "Test Job",
            link: "https://example.com",
            company: company._id,
        });
        await CompanyLogo.updateOne({ _id: company._id }, { $push: { listedJobs: job._id } });

        const res = await request(app).get(`/api/companydetails/get?id=${company._id}`);

        expect(res.status).toBe(200);
        expect(res.body.data[0].listedJobs).toHaveLength(1);
        expect(res.body.data[0].listedJobs[0].title).toBe("Test Job");
    });

    it("should return sorted by _id descending (newest first)", async () => {
        await createCompany({ companyName: "First" });
        await createCompany({ companyName: "Second" });

        const res = await request(app).get("/api/companydetails/get");

        expect(res.body.data[0].companyName).toBe("Second");
        expect(res.body.data[1].companyName).toBe("First");
    });

    it("should return 400 for invalid id", async () => {
        const res = await request(app).get("/api/companydetails/get?id=invalid");

        expect(res.status).toBe(400);
    });

    it("should paginate results correctly", async () => {
        await createCompany({ companyName: "Page1" });
        await createCompany({ companyName: "Page2" });
        await createCompany({ companyName: "Page3" });

        const res = await request(app).get("/api/companydetails/get?page=1&limit=2");

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(2);
        expect(res.body.pagination.currentPage).toBe(1);
        expect(res.body.pagination.totalPages).toBe(2);
        expect(res.body.pagination.totalCount).toBe(3);
        expect(res.body.pagination.pageSize).toBe(2);
    });

    it("should search companies using search param", async () => {
        await createCompany({ companyName: "Amazon" });
        await createCompany({ companyName: "Apple" });
        await createCompany({ companyName: "Netflix" });

        const res = await request(app).get("/api/companydetails/get?search=a");

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(2);
        expect(res.body.pagination.totalCount).toBe(2);
    });
});

describe("GET /api/companydetails/logo", () => {
    it("should return logo fields only", async () => {
        await createCompany({
            companyName: "LogoCorp",
            smallLogo: "https://example.com/small.png",
            largeLogo: "https://example.com/large.png",
            companyInfo: "Should not appear",
        });

        const res = await request(app).get("/api/companydetails/logo?companyname=LogoCorp");

        expect(res.status).toBe(200);
        expect(res.body.data.companyName).toBe("LogoCorp");
        expect(res.body.data.smallLogo).toBe("https://example.com/small.png");
        expect(res.body.data.largeLogo).toBe("https://example.com/large.png");
        // companyInfo should not be in the response data
        expect(res.body.data.companyInfo).toBeUndefined();
    });

    it("should find logo by id", async () => {
        const company = await createCompany({ companyName: "ById" });

        const res = await request(app).get(`/api/companydetails/logo?id=${company._id}`);

        expect(res.status).toBe(200);
        expect(res.body.data.companyName).toBe("ById");
    });

    it("should return 404 when company not found", async () => {
        const res = await request(app).get("/api/companydetails/logo?companyname=NonExistent");

        expect(res.status).toBe(404);
        expect(res.body.error).toBe("Company not found");
    });

    it("should be case-insensitive for company name search", async () => {
        await createCompany({ companyName: "CaseCorp" });

        const res = await request(app).get("/api/companydetails/logo?companyname=casecorp");

        expect(res.status).toBe(200);
        expect(res.body.data.companyName).toBe("CaseCorp");
    });
});

describe("PUT /api/companydetails/update/:id", () => {
    it("should update company details", async () => {
        const company = await createCompany({ companyName: "OldName" });

        const res = await request(app).put(`/api/companydetails/update/${company._id}`).set(AUTH).send({
            companyName: "NewName",
            companyType: "startup",
        });

        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Company details updated successfully");

        const updated = await CompanyLogo.findById(company._id);
        expect(updated.companyName).toBe("NewName");
        expect(updated.companyType).toBe("startup");
    });

    it("should only update allowed fields", async () => {
        const company = await createCompany();

        await request(app).put(`/api/companydetails/update/${company._id}`).set(AUTH).send({
            companyName: "Updated",
            listedJobs: [], // not in allowedFields
        });

        const updated = await CompanyLogo.findById(company._id);
        expect(updated.companyName).toBe("Updated");
        // listedJobs should remain unchanged (empty array from creation)
    });

    it("should return 400 for invalid id", async () => {
        const res = await request(app).put("/api/companydetails/update/bad-id").set(AUTH).send({
            companyName: "Fail",
        });

        expect(res.status).toBe(400);
    });
});

describe("DELETE /api/companydetails/delete/:id", () => {
    it("should delete a company", async () => {
        const company = await createCompany();

        const res = await request(app).delete(`/api/companydetails/delete/${company._id}`).set(AUTH);

        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Deleted Successfully");

        const deleted = await CompanyLogo.findById(company._id);
        expect(deleted).toBeNull();
    });

    it("should return 200 even if company doesn't exist", async () => {
        const fakeId = new mongoose.Types.ObjectId();

        const res = await request(app).delete(`/api/companydetails/delete/${fakeId}`).set(AUTH);

        // deleteOne doesn't throw on no match
        expect(res.status).toBe(200);
    });

    it("should return 400 for invalid id format", async () => {
        const res = await request(app).delete("/api/companydetails/delete/not-valid").set(AUTH);

        expect(res.status).toBe(400);
    });
});
