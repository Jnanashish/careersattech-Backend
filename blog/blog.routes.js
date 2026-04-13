const express = require("express");
const router = express.Router();

const {
    listPublicBlogs,
    getBlogBySlug,
    getRelatedBlogs,
    getSitemap,
    getRssFeed,
} = require("./blog.controllers");

// Static routes BEFORE :slug param to avoid matching "sitemap", "rss", "related"
router.get("/blogs/sitemap", getSitemap);
router.get("/blogs/rss", getRssFeed);
router.get("/blogs/related/:slug", getRelatedBlogs);
router.get("/blogs/:slug", getBlogBySlug);
router.get("/blogs", listPublicBlogs);

module.exports = router;
