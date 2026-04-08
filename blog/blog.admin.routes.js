const express = require("express");
const router = express.Router();

const requireAuth = require("../middleware/auth");
const validateObjectId = require("../middleware/validateObjectId");
const {
    createBlog,
    listAdminBlogs,
    getAdminBlog,
    updateBlog,
    deleteBlog,
    publishBlog,
    uploadImage,
} = require("./blog.controllers");
const {
    createBlogSchema,
    updateBlogSchema,
    publishBlogSchema,
    validate,
} = require("./blog.validators");

// All admin blog routes require authentication
router.post("/admin/blogs", requireAuth, validate(createBlogSchema), createBlog);
router.get("/admin/blogs", requireAuth, listAdminBlogs);
router.get("/admin/blogs/:id", requireAuth, validateObjectId, getAdminBlog);
router.patch("/admin/blogs/:id", requireAuth, validateObjectId, validate(updateBlogSchema), updateBlog);
router.delete("/admin/blogs/:id", requireAuth, validateObjectId, deleteBlog);
router.post("/admin/blogs/:id/publish", requireAuth, validateObjectId, validate(publishBlogSchema), publishBlog);
router.post("/admin/upload", requireAuth, uploadImage);

module.exports = router;
