const { z } = require("zod");
const mongoose = require("mongoose");

const JOB_STATUS = ["draft", "published", "paused", "expired", "archived"];
const EMPLOYMENT_TYPE = ["FULL_TIME", "PART_TIME", "CONTRACTOR", "INTERN", "TEMPORARY"];
const DISPLAY_MODE = ["internal", "external_redirect"];
const CATEGORY = ["engineering", "design", "product", "data", "devops", "qa", "management", "other"];
const WORK_MODE = ["onsite", "hybrid", "remote"];
const SALARY_UNIT = ["HOUR", "DAY", "WEEK", "MONTH", "YEAR"];
const APPLY_PLATFORM = ["careerspage", "linkedin", "cuvette", "email", "other"];
const SPONSORSHIP_TIER = ["none", "boosted", "featured", "sponsored"];
const SOURCE = ["manual", "scraped", "api", "recruiter_submitted"];

const objectIdSchema = z.string().refine((v) => mongoose.Types.ObjectId.isValid(v), {
    message: "Invalid ObjectId",
});

const jobDescriptionSchema = z.object({
    html: z.string().optional(),
    plain: z.string().optional(),
}).optional();

const experienceSchema = z.object({
    min: z.number().int().min(0).optional(),
    max: z.number().int().min(0).optional(),
}).optional();

const jobLocationItemSchema = z.object({
    city: z.string().optional(),
    region: z.string().optional(),
    country: z.string().optional(),
});

const baseSalarySchema = z.object({
    currency: z.string().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    unitText: z.enum(SALARY_UNIT).optional(),
}).optional();

const sponsorshipSchema = z.object({
    tier: z.enum(SPONSORSHIP_TIER).optional(),
    activeUntil: z.string().datetime().optional(),
}).optional();

const statsSchema = z.object({
    applyClicks: z.number().int().min(0).optional(),
    pageViews: z.number().int().min(0).optional(),
}).optional();

const seoSchema = z.object({
    metaTitle: z.string().optional(),
    metaDescription: z.string().optional(),
    ogImage: z.string().optional(),
}).optional();

const createJobV2Schema = z.object({
    title: z.string().min(1).max(200),
    slug: z.string().max(100).optional(),

    company: objectIdSchema,
    companyName: z.string().min(1).max(200),

    displayMode: z.enum(DISPLAY_MODE),
    applyLink: z.string().url().max(2000),

    employmentType: z.array(z.enum(EMPLOYMENT_TYPE)).min(1),
    batch: z
        .array(z.number().int().min(2020).max(2030))
        .min(1)
        .refine((v) => new Set(v).size === v.length, {
            message: "Batch years must be unique",
        }),

    jobDescription: jobDescriptionSchema,

    category: z.enum(CATEGORY).nullable().optional(),
    workMode: z.enum(WORK_MODE).nullable().optional(),

    degree: z.array(z.string()).optional(),
    experience: experienceSchema,

    jobLocation: z.array(jobLocationItemSchema).optional(),
    baseSalary: baseSalarySchema,

    requiredSkills: z.array(z.string()).optional(),
    preferredSkills: z.array(z.string()).optional(),
    topicTags: z.array(z.string()).optional(),

    applyPlatform: z.enum(APPLY_PLATFORM).optional(),

    datePosted: z.string().datetime().optional(),
    validThrough: z.string().datetime().optional(),

    status: z.enum(JOB_STATUS).optional(),
    isVerified: z.boolean().optional(),

    sponsorship: sponsorshipSchema,
    priority: z.number().int().min(0).optional(),

    stats: statsSchema,
    jdBanner: z.string().optional(),

    seo: seoSchema,

    source: z.enum(SOURCE).optional(),
    externalJobId: z.string().optional(),
    postedBy: z.string().optional(),
});

const updateJobV2Schema = createJobV2Schema.partial();

const listJobV2QuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    status: z.enum(JOB_STATUS).optional(),
    search: z.string().max(200).optional(),
    company: objectIdSchema.optional(),
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
    createJobV2Schema,
    updateJobV2Schema,
    listJobV2QuerySchema,
    validate,
    validateQuery,
    JOB_STATUS,
};
