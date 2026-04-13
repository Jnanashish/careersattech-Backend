const { z } = require("zod");

const noHtml = (val) => !/<[^>]*script|<[^>]*iframe/i.test(val);

const coverImageSchema = z.object({
    url: z.string().url().optional(),
    alt: z.string().max(300).optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    blurhash: z.string().optional(),
}).optional();

const authorSchema = z.object({
    name: z.string().min(1).max(100),
    avatar: z.string().url().optional(),
    bio: z.string().max(500).optional(),
    social: z.record(z.string().url()).optional(),
});

const seoSchema = z.object({
    metaTitle: z.string().max(60).optional(),
    metaDescription: z.string().max(160).optional(),
    canonicalUrl: z.string().url().optional(),
    ogImage: z.string().url().optional(),
    keywords: z.array(z.string().max(50)).max(20).optional(),
    noindex: z.boolean().optional(),
}).optional();

const createBlogSchema = z.object({
    title: z.string().min(1).max(200).refine(noHtml, { message: "HTML not allowed in title" }),
    content: z.string().min(1),
    category: z.string().min(1).max(100),
    author: authorSchema,
    excerpt: z.string().max(300).refine(noHtml, { message: "HTML not allowed in excerpt" }).optional(),
    tags: z.array(z.string().max(50)).max(10).optional(),
    coverImage: coverImageSchema,
    seo: seoSchema,
    slug: z.string().max(200).optional(),
});

const updateBlogSchema = createBlogSchema.partial();

const publishBlogSchema = z.object({
    scheduledFor: z.string().datetime().optional().refine(
        (val) => !val || new Date(val) > new Date(),
        { message: "scheduledFor must be a future date" }
    ),
});

const queryBlogsSchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    size: z.coerce.number().int().min(1).max(100).optional(),
    status: z.enum(["draft", "scheduled", "published", "archived"]).optional(),
    category: z.string().optional(),
    tag: z.string().optional(),
    search: z.string().max(200).optional(),
});

const validate = (schema) => (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
        return res.status(400).json({
            error: "Validation failed",
            details: result.error.issues.map((i) => ({
                path: i.path.join("."),
                message: i.message,
            })),
        });
    }
    req.validated = result.data;
    next();
};

const validateQuery = (schema) => (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
        return res.status(400).json({
            error: "Invalid query parameters",
            details: result.error.issues.map((i) => ({
                path: i.path.join("."),
                message: i.message,
            })),
        });
    }
    req.validatedQuery = result.data;
    next();
};

module.exports = {
    createBlogSchema,
    updateBlogSchema,
    publishBlogSchema,
    queryBlogsSchema,
    validate,
    validateQuery,
};
