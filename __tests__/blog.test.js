const request = require("supertest");
const mongoose = require("mongoose");

require("./setup");
const createApp = require("./createApp");
const Blog = require("../blog/blog.schema");

let app;
const AUTH = { "x-api-key": "test-secret-key" };

beforeAll(() => {
    app = createApp({ only: ["blogPublic", "blogAdmin"] });
});

async function makeBlog(overrides = {}) {
    return Blog.create({
        title: overrides.title || "Sample Post",
        slug: overrides.slug || "sample-post-" + Math.random().toString(36).slice(2, 8),
        content: overrides.content || "# Hello\n\nBody",
        contentHtml: overrides.contentHtml || "<h1>Hello</h1>",
        category: overrides.category || "career",
        author: overrides.author || { name: "Jane" },
        status: overrides.status || "published",
        publishedAt: overrides.publishedAt || new Date(),
        ...overrides,
    });
}

// ===========================================================================
//  PUBLIC ROUTES
// ===========================================================================

describe("GET /api/blogs (public list)", () => {
    it("returns only published posts", async () => {
        await makeBlog({ title: "P1", status: "published" });
        await makeBlog({ title: "D1", status: "draft", slug: "draft-1" });

        const res = await request(app).get("/api/blogs");
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].title).toBe("P1");
    });

    it("paginates and filters by category", async () => {
        await makeBlog({ title: "Career 1", category: "career" });
        await makeBlog({ title: "Tech 1", category: "tech", slug: "tech-1" });

        const career = await request(app).get("/api/blogs?category=career");
        expect(career.body.totalCount).toBe(1);
        expect(career.body.data[0].title).toBe("Career 1");
    });

    it("filters by tag", async () => {
        await makeBlog({ title: "Tagged", tags: ["javascript"] });
        await makeBlog({ title: "Not Tagged", tags: ["python"], slug: "not-tagged" });

        const res = await request(app).get("/api/blogs?tag=javascript");
        expect(res.body.totalCount).toBe(1);
    });

    it("sets cache headers", async () => {
        const res = await request(app).get("/api/blogs");
        expect(res.headers["cache-control"]).toContain("s-maxage");
    });
});

describe("GET /api/blogs/:slug", () => {
    it("returns 404 if not published", async () => {
        await makeBlog({ slug: "draft-only", status: "draft" });
        const res = await request(app).get("/api/blogs/draft-only");
        expect(res.status).toBe(404);
    });

    it("returns full post for published slug", async () => {
        await makeBlog({ slug: "live-post", title: "Live!" });
        const res = await request(app).get("/api/blogs/live-post");
        expect(res.status).toBe(200);
        expect(res.body.data.title).toBe("Live!");
    });
});

describe("GET /api/blogs/sitemap", () => {
    it("returns published slugs only", async () => {
        await makeBlog({ slug: "in-sitemap", status: "published" });
        await makeBlog({ slug: "drafted-out", status: "draft" });
        const res = await request(app).get("/api/blogs/sitemap");
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].slug).toBe("in-sitemap");
    });
});

describe("GET /api/blogs/rss", () => {
    it("returns RSS XML", async () => {
        await makeBlog({ slug: "rss-post", title: "RSS Title" });
        const res = await request(app).get("/api/blogs/rss");
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toContain("application/rss+xml");
        expect(res.text).toContain("<rss version=\"2.0\"");
        expect(res.text).toContain("RSS Title");
    });
});

describe("GET /api/blogs/related/:slug", () => {
    it("returns 404 for unknown slug", async () => {
        const res = await request(app).get("/api/blogs/related/missing");
        expect(res.status).toBe(404);
    });

    it("returns related posts by tag overlap", async () => {
        await makeBlog({ slug: "anchor", tags: ["js"] });
        await makeBlog({ slug: "related", tags: ["js"] });
        await makeBlog({ slug: "unrelated", tags: ["py"] });

        const res = await request(app).get("/api/blogs/related/anchor");
        expect(res.status).toBe(200);
        const slugs = res.body.data.map((b) => b.slug);
        expect(slugs).toContain("related");
    });
});

// ===========================================================================
//  ADMIN ROUTES
// ===========================================================================

describe("POST /api/admin/blogs", () => {
    it("rejects without auth (401)", async () => {
        const res = await request(app).post("/api/admin/blogs").send({});
        expect(res.status).toBe(401);
    });

    it("rejects invalid payload (400)", async () => {
        const res = await request(app).post("/api/admin/blogs").set(AUTH).send({
            title: "No body",
        });
        expect(res.status).toBe(400);
    });

    it("creates a draft from valid payload", async () => {
        const res = await request(app)
            .post("/api/admin/blogs")
            .set(AUTH)
            .send({
                title: "My First Post",
                content: "# Hi\n\nLet's go.",
                category: "career",
                author: { name: "Author" },
            });

        expect(res.status).toBe(201);
        expect(res.body.data.slug).toMatch(/^my-first-post/);

        const stored = await Blog.findById(res.body.data._id);
        expect(stored.status).toBe("draft");
    });
});

describe("GET /api/admin/blogs", () => {
    it("lists drafts and published together", async () => {
        await makeBlog({ slug: "admin-list-pub", status: "published" });
        await makeBlog({ slug: "admin-list-draft", status: "draft" });

        const res = await request(app).get("/api/admin/blogs").set(AUTH);
        expect(res.status).toBe(200);
        expect(res.body.totalCount).toBe(2);
    });
});

describe("PATCH /api/admin/blogs/:id", () => {
    it("updates blog fields", async () => {
        const blog = await makeBlog({ slug: "patch-me", title: "Old" });
        const res = await request(app)
            .patch(`/api/admin/blogs/${blog._id}`)
            .set(AUTH)
            .send({
                title: "New",
                content: "# new content",
                category: "career",
                author: { name: "Author" },
            });
        expect(res.status).toBe(200);

        const fresh = await Blog.findById(blog._id);
        expect(fresh.title).toBe("New");
    });

    it("blocks edits to archived posts (400)", async () => {
        const blog = await makeBlog({ slug: "archived-blog", status: "archived" });
        const res = await request(app)
            .patch(`/api/admin/blogs/${blog._id}`)
            .set(AUTH)
            .send({
                title: "T",
                content: "c",
                category: "career",
                author: { name: "A" },
            });
        expect(res.status).toBe(400);
    });
});

describe("POST /api/admin/blogs/:id/publish", () => {
    it("publishes a draft immediately", async () => {
        const blog = await makeBlog({ slug: "to-publish", status: "draft", publishedAt: undefined });
        const res = await request(app)
            .post(`/api/admin/blogs/${blog._id}/publish`)
            .set(AUTH)
            .send({});
        expect(res.status).toBe(200);

        const fresh = await Blog.findById(blog._id);
        expect(fresh.status).toBe("published");
        expect(fresh.publishedAt).toBeTruthy();
    });

    it("schedules a future publish", async () => {
        const blog = await makeBlog({ slug: "to-schedule", status: "draft", publishedAt: undefined });
        const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        const res = await request(app)
            .post(`/api/admin/blogs/${blog._id}/publish`)
            .set(AUTH)
            .send({ scheduledFor: future });
        expect(res.status).toBe(200);

        const fresh = await Blog.findById(blog._id);
        expect(fresh.status).toBe("scheduled");
    });

    it("rejects past scheduledFor (400)", async () => {
        const blog = await makeBlog({ slug: "past-sched", status: "draft" });
        const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const res = await request(app)
            .post(`/api/admin/blogs/${blog._id}/publish`)
            .set(AUTH)
            .send({ scheduledFor: past });
        expect(res.status).toBe(400);
    });
});

describe("DELETE /api/admin/blogs/:id", () => {
    it("archives the post", async () => {
        const blog = await makeBlog({ slug: "to-delete" });
        const res = await request(app).delete(`/api/admin/blogs/${blog._id}`).set(AUTH);
        expect(res.status).toBe(200);

        const fresh = await Blog.findById(blog._id);
        expect(fresh.status).toBe("archived");
    });

    it("returns 404 for missing id", async () => {
        const fake = new mongoose.Types.ObjectId();
        const res = await request(app).delete(`/api/admin/blogs/${fake}`).set(AUTH);
        expect(res.status).toBe(404);
    });
});
