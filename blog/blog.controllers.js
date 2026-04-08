const fs = require("fs");
const axios = require("axios");
const Blog = require("./blog.schema");
const { processBlogPost } = require("./blog.service");
const { uploadImage, ALLOWED_TYPES } = require("./cloudinary.service");
const { apiErrorHandler, escapeRegex } = require("../Helpers/controllerHelper");

const CACHE_HEADER = "s-maxage=60, stale-while-revalidate=300";

// ---------------------------------------------------------------------------
// Revalidation helper (fire-and-forget)
// ---------------------------------------------------------------------------
function triggerRevalidation(slug) {
    const url = process.env.NEXT_REVALIDATION_URL || process.env.SITE_REVALIDATE_URL;
    const secret = process.env.REVALIDATE_SECRET;
    if (!url || !secret) return;

    const paths = slug ? [`/blog/${slug}`, "/blog"] : ["/blog"];
    axios.post(url, { secret, paths }).catch((err) => {
        console.error("[Blog] Revalidation failed:", err.message);
    });
}

function setCacheHeaders(res) {
    res.set("Cache-Control", CACHE_HEADER);
}

// ===========================================================================
//  ADMIN CONTROLLERS (require auth)
// ===========================================================================

/**
 * POST /api/admin/blogs — Create a draft blog post
 */
exports.createBlog = async (req, res) => {
    try {
        const data = req.validated;
        const processed = await processBlogPost(data);
        processed.status = "draft";

        const blog = await Blog.create(processed);

        return res.status(201).json({
            message: "Blog draft created",
            data: { _id: blog._id, slug: blog.slug },
        });
    } catch (err) {
        if (err.code === 11000) {
            return res.status(409).json({ error: "A blog with this slug already exists" });
        }
        return apiErrorHandler(err, res);
    }
};

/**
 * GET /api/admin/blogs — List blogs with filters
 * Query: page, size, status, search
 */
exports.listAdminBlogs = async (req, res) => {
    try {
        const { page = 1, size = 20, status, search } = req.query;
        const limit = Math.min(Math.max(parseInt(size) || 20, 1), 100);
        const pageNum = Math.max(parseInt(page) || 1, 1);
        const skip = (pageNum - 1) * limit;

        const conditions = {};
        if (status) conditions.status = status;
        if (search) {
            const escaped = escapeRegex(search);
            conditions.$or = [
                { title: { $regex: escaped, $options: "i" } },
                { tags: { $regex: escaped, $options: "i" } },
                { category: { $regex: escaped, $options: "i" } },
            ];
        }

        const [data, totalCount] = await Promise.all([
            Blog.find(conditions)
                .select("-content -contentHtml -tableOfContents")
                .sort({ updatedAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Blog.countDocuments(conditions),
        ]);

        return res.status(200).json({ data, totalCount, page: pageNum, size: limit });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};

/**
 * GET /api/admin/blogs/:id — Fetch single blog for editing
 */
exports.getAdminBlog = async (req, res) => {
    try {
        const blog = await Blog.findById(req.params.id).lean();
        if (!blog) return res.status(404).json({ error: "Blog not found" });
        return res.status(200).json({ data: blog });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};

/**
 * PATCH /api/admin/blogs/:id — Update blog
 */
exports.updateBlog = async (req, res) => {
    try {
        const existing = await Blog.findById(req.params.id);
        if (!existing) return res.status(404).json({ error: "Blog not found" });
        if (existing.status === "archived") {
            return res.status(400).json({ error: "Cannot edit an archived post" });
        }

        const data = req.validated;
        const processed = await processBlogPost(data, existing);

        Object.assign(existing, processed);
        await existing.save();

        if (existing.status === "published") {
            triggerRevalidation(existing.slug);
        }

        return res.status(200).json({ message: "Blog updated" });
    } catch (err) {
        if (err.code === 11000) {
            return res.status(409).json({ error: "A blog with this slug already exists" });
        }
        return apiErrorHandler(err, res);
    }
};

/**
 * DELETE /api/admin/blogs/:id — Soft delete (archive)
 */
exports.deleteBlog = async (req, res) => {
    try {
        const blog = await Blog.findById(req.params.id);
        if (!blog) return res.status(404).json({ error: "Blog not found" });

        const slug = blog.slug;
        blog.status = "archived";
        await blog.save();

        triggerRevalidation(slug);

        return res.status(200).json({ message: "Blog archived" });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};

/**
 * POST /api/admin/blogs/:id/publish — Publish or schedule
 * Body: { scheduledFor?: ISO date string }
 */
exports.publishBlog = async (req, res) => {
    try {
        const blog = await Blog.findById(req.params.id);
        if (!blog) return res.status(404).json({ error: "Blog not found" });
        if (blog.status === "archived") {
            return res.status(400).json({ error: "Cannot publish an archived post" });
        }

        const { scheduledFor } = req.validated || {};

        if (scheduledFor) {
            blog.status = "scheduled";
            blog.scheduledFor = new Date(scheduledFor);
        } else {
            blog.status = "published";
            // Set publishedAt only on first publish
            if (!blog.publishedAt) {
                blog.publishedAt = new Date();
            }
            blog.scheduledFor = undefined;
        }

        await blog.save();
        triggerRevalidation(blog.slug);

        return res.status(200).json({
            message: scheduledFor ? "Blog scheduled" : "Blog published",
        });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};

/**
 * POST /api/admin/upload — Upload image to Cloudinary
 * Returns { url, width, height, blurhash }
 */
exports.uploadImage = async (req, res) => {
    try {
        if (!req.files?.image) {
            return res.status(400).json({ error: "No image file provided (field: image)" });
        }

        const file = req.files.image;

        if (!ALLOWED_TYPES.includes(file.mimetype)) {
            return res.status(400).json({
                error: `Invalid file type. Allowed: ${ALLOWED_TYPES.join(", ")}`,
            });
        }

        if (!file.tempFilePath || !fs.existsSync(file.tempFilePath)) {
            return res.status(400).json({ error: "Upload failed — temp file not found" });
        }

        const result = await uploadImage(file.tempFilePath);

        return res.status(200).json({
            url: result.url,
            width: result.width,
            height: result.height,
            blurhash: result.blurhash,
        });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};

// ===========================================================================
//  PUBLIC CONTROLLERS (no auth, cached)
// ===========================================================================

/**
 * GET /api/blogs — Paginated published list
 * Query: page, size, category, tag, search
 */
exports.listPublicBlogs = async (req, res) => {
    try {
        setCacheHeaders(res);

        const { page = 1, size = 20, category, tag, search } = req.query;
        const limit = Math.min(Math.max(parseInt(size) || 20, 1), 100);
        const pageNum = Math.max(parseInt(page) || 1, 1);
        const skip = (pageNum - 1) * limit;

        const conditions = { status: "published" };
        if (category) conditions.category = category;
        if (tag) conditions.tags = tag;
        if (search) {
            const escaped = escapeRegex(search);
            conditions.title = { $regex: escaped, $options: "i" };
        }

        const [data, totalCount] = await Promise.all([
            Blog.find(conditions)
                .select("title slug excerpt coverImage author category tags publishedAt readingTime views")
                .sort({ publishedAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Blog.countDocuments(conditions),
        ]);

        return res.status(200).json({ data, totalCount, page: pageNum, size: limit });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};

/**
 * GET /api/blogs/:slug — Single post by slug
 */
exports.getBlogBySlug = async (req, res) => {
    try {
        setCacheHeaders(res);

        const blog = await Blog.findOne({ slug: req.params.slug, status: "published" })
            .select("-__v")
            .lean();

        if (!blog) return res.status(404).json({ error: "Blog not found" });

        // Increment view count fire-and-forget
        Blog.updateOne({ _id: blog._id }, { $inc: { views: 1 } }).catch((err) =>
            console.error("[Blog] View increment failed:", err.message)
        );

        return res.status(200).json({ data: blog });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};

/**
 * GET /api/blogs/related/:slug — 5 related posts by tag/category overlap
 */
exports.getRelatedBlogs = async (req, res) => {
    try {
        setCacheHeaders(res);

        const blog = await Blog.findOne({ slug: req.params.slug, status: "published" })
            .select("tags category")
            .lean();

        if (!blog) return res.status(404).json({ error: "Blog not found" });

        const related = await Blog.aggregate([
            {
                $match: {
                    status: "published",
                    slug: { $ne: req.params.slug },
                    $or: [
                        { tags: { $in: blog.tags || [] } },
                        { category: blog.category },
                    ],
                },
            },
            {
                $addFields: {
                    relevance: {
                        $add: [
                            { $size: { $setIntersection: [{ $ifNull: ["$tags", []] }, blog.tags || []] } },
                            { $cond: [{ $eq: ["$category", blog.category] }, 2, 0] },
                        ],
                    },
                },
            },
            { $sort: { relevance: -1, publishedAt: -1 } },
            { $limit: 5 },
            {
                $project: {
                    title: 1,
                    slug: 1,
                    excerpt: 1,
                    coverImage: 1,
                    category: 1,
                    tags: 1,
                    publishedAt: 1,
                    readingTime: 1,
                },
            },
        ]);

        return res.status(200).json({ data: related });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};

/**
 * GET /api/blogs/sitemap — All published slugs + updatedAt
 */
exports.getSitemap = async (req, res) => {
    try {
        res.set("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");

        const data = await Blog.find({ status: "published" })
            .select("slug updatedAt")
            .sort({ updatedAt: -1 })
            .lean();

        return res.status(200).json({ data });
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};

/**
 * GET /api/blogs/rss — RSS 2.0 XML feed
 */
exports.getRssFeed = async (req, res) => {
    try {
        res.set("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
        res.set("Content-Type", "application/rss+xml; charset=utf-8");

        const siteUrl = process.env.SITE_URL || "https://careersat.tech";
        const siteTitle = process.env.SITE_TITLE || "CareersAt.Tech Blog";
        const siteDescription = process.env.SITE_DESCRIPTION || "Career advice and tech industry insights";

        const posts = await Blog.find({ status: "published" })
            .select("title slug excerpt publishedAt category")
            .sort({ publishedAt: -1 })
            .limit(50)
            .lean();

        const escXml = (str) =>
            (str || "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&apos;");

        const items = posts
            .map(
                (p) => `    <item>
      <title>${escXml(p.title)}</title>
      <link>${siteUrl}/blog/${encodeURIComponent(p.slug)}</link>
      <guid isPermaLink="true">${siteUrl}/blog/${encodeURIComponent(p.slug)}</guid>
      <description>${escXml(p.excerpt)}</description>
      <category>${escXml(p.category)}</category>
      <pubDate>${new Date(p.publishedAt).toUTCString()}</pubDate>
    </item>`
            )
            .join("\n");

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escXml(siteTitle)}</title>
    <link>${siteUrl}/blog</link>
    <description>${escXml(siteDescription)}</description>
    <language>en</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${siteUrl}/api/blogs/rss" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`;

        return res.status(200).send(xml);
    } catch (err) {
        return apiErrorHandler(err, res);
    }
};
