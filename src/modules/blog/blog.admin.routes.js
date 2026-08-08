const express = require("express");
const router = express.Router();

const requireAuth = require("../../middleware/auth");
const validateObjectId = require("../../middleware/validateObjectId");
const requirePermanentFlag = require("../../middleware/requirePermanentFlag");
const {
    createBlog,
    listAdminBlogs,
    getAdminBlog,
    updateBlog,
    archiveBlog,
    hardDeleteBlog,
    publishBlog,
    uploadImage,
} = require("./blog.controller");
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
// POST /:id/archive = reversible soft delete. DELETE /:id = permanent removal.
router.post("/admin/blogs/:id/archive", requireAuth, validateObjectId, archiveBlog);
router.delete("/admin/blogs/:id", requireAuth, validateObjectId, requirePermanentFlag, hardDeleteBlog);
router.post("/admin/blogs/:id/publish", requireAuth, validateObjectId, validate(publishBlogSchema), publishBlog);
router.post("/admin/upload", requireAuth, uploadImage);

module.exports = router;
