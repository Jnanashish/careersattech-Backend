const request = require("supertest");
const mongoose = require("mongoose");

require("./setup");
const createApp = require("./createApp");
const Jobdesc = require("../model/jobs.schema");
const CompanyLogo = require("../model/company.schema");

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
const BAD_AUTH = { "x-api-key": "wrong-key" };

beforeAll(() => {
    app = createApp();
});

// --- Authentication Tests ---

describe("Authentication", () => {
    test("POST /api/jd/add without auth returns 401", async () => {
        const res = await request(app)
            .post("/api/jd/add")
            .send({ title: "Test", link: "https://example.com" });
        expect(res.status).toBe(401);
        expect(res.body.error).toBe("Unauthorized");
    });

    test("POST /api/jd/add with wrong key returns 401", async () => {
        const res = await request(app)
            .post("/api/jd/add")
            .set(BAD_AUTH)
            .send({ title: "Test", link: "https://example.com" });
        expect(res.status).toBe(401);
    });

    test("DELETE /api/jd/delete/:id without auth returns 401", async () => {
        const id = new mongoose.Types.ObjectId();
        const res = await request(app).delete(`/api/jd/delete/${id}`);
        expect(res.status).toBe(401);
    });

    test("PUT /api/jd/update/:id without auth returns 401", async () => {
        const id = new mongoose.Types.ObjectId();
        const res = await request(app).put(`/api/jd/update/${id}`).send({ title: "X" });
        expect(res.status).toBe(401);
    });

    test("POST /api/companydetails/add without auth returns 401", async () => {
        const res = await request(app)
            .post("/api/companydetails/add")
            .send({ companyName: "Test Co" });
        expect(res.status).toBe(401);
    });

    test("PUT /api/companydetails/update/:id without auth returns 401", async () => {
        const id = new mongoose.Types.ObjectId();
        const res = await request(app).put(`/api/companydetails/update/${id}`).send({ companyName: "X" });
        expect(res.status).toBe(401);
    });

    test("DELETE /api/companydetails/delete/:id without auth returns 401", async () => {
        const id = new mongoose.Types.ObjectId();
        const res = await request(app).delete(`/api/companydetails/delete/${id}`);
        expect(res.status).toBe(401);
    });

    test("POST /api/jd/getposterlink without auth returns 401", async () => {
        const res = await request(app).post("/api/jd/getposterlink");
        expect(res.status).toBe(401);
    });

    // Public endpoints should NOT require auth
    test("GET /api/jd/get is public", async () => {
        const res = await request(app).get("/api/jd/get");
        expect(res.status).toBe(200);
    });

    test("GET /api/companydetails/get is public", async () => {
        const res = await request(app).get("/api/companydetails/get");
        expect(res.status).toBe(200);
    });

    test("PATCH /api/jd/update/count/:id is public (click tracking)", async () => {
        const id = new mongoose.Types.ObjectId();
        const res = await request(app).patch(`/api/jd/update/count/${id}`);
        expect(res.status).not.toBe(401);
    });

    test("Auth via Bearer token header works", async () => {
        const res = await request(app)
            .post("/api/companydetails/add")
            .set("Authorization", "Bearer test-secret-key")
            .send({ companyName: "Bearer Test Co" });
        expect(res.status).toBe(200);
    });
});

// --- ObjectId Validation Tests ---

describe("ObjectId Validation", () => {
    test("DELETE /api/jd/delete/invalidId returns 400", async () => {
        const res = await request(app).delete("/api/jd/delete/notAnObjectId").set(AUTH);
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Invalid ID format");
    });

    test("PUT /api/jd/update/invalidId returns 400", async () => {
        const res = await request(app).put("/api/jd/update/notAnObjectId").set(AUTH).send({ title: "X" });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Invalid ID format");
    });

    test("PATCH /api/jd/update/count/invalidId returns 400", async () => {
        const res = await request(app).patch("/api/jd/update/count/notAnObjectId");
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Invalid ID format");
    });

    test("PUT /api/companydetails/update/invalidId returns 400", async () => {
        const res = await request(app).put("/api/companydetails/update/notAnObjectId").set(AUTH).send({ companyName: "X" });
        expect(res.status).toBe(400);
    });

    test("DELETE /api/companydetails/delete/invalidId returns 400", async () => {
        const res = await request(app).delete("/api/companydetails/delete/notAnObjectId").set(AUTH);
        expect(res.status).toBe(400);
    });
});

// --- Mass Assignment Tests ---

describe("Mass Assignment Prevention", () => {
    test("POST /api/jd/add strips totalclick and adclick from body", async () => {
        const res = await request(app)
            .post("/api/jd/add")
            .set(AUTH)
            .send({
                title: "Mass Assignment Test",
                link: "https://example.com",
                totalclick: 99999,
                adclick: 50000,
            });

        expect(res.status).toBe(201);

        const job = await Jobdesc.findOne({ title: "Mass Assignment Test" });
        expect(job.totalclick).toBe(0);
        expect(job.adclick).toBe(0);
    });

    test("POST /api/companydetails/add strips listedJobs from body", async () => {
        const fakeJobId = new mongoose.Types.ObjectId();

        const res = await request(app)
            .post("/api/companydetails/add")
            .set(AUTH)
            .send({
                companyName: "Mass Assignment Co",
                listedJobs: [fakeJobId],
            });

        expect(res.status).toBe(200);

        const company = await CompanyLogo.findOne({ companyName: "Mass Assignment Co" });
        expect(company.listedJobs).toHaveLength(0);
    });
});
