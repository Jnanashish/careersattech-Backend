const { z } = require("zod");

const COMPANY_STATUS = ["active", "inactive", "archived"];
const COMPANY_TYPE = [
    "product",
    "service",
    "startup",
    "mnc",
    "consulting",
    "unicorn",
    "bigtech",
    "other",
];
const EMPLOYEE_COUNT = [
    "1-10",
    "11-50",
    "51-200",
    "201-500",
    "501-1000",
    "1001-5000",
    "5000+",
];
const SPONSORSHIP_TIER = ["none", "featured", "sponsored"];

const logoSchema = z.object({
    icon: z.string().optional(),
    banner: z.string().optional(),
    iconAlt: z.string().optional(),
    bgColor: z.string().optional(),
}).optional();

const descriptionSchema = z.object({
    short: z.string().optional(),
    long: z.string().optional(),
}).optional();

const socialLinksSchema = z.object({
    linkedin: z.string().optional(),
    twitter: z.string().optional(),
    instagram: z.string().optional(),
    glassdoor: z.string().optional(),
}).optional();

const ratingsSchema = z.object({
    glassdoor: z.number().min(0).max(5).optional(),
    ambitionBox: z.number().min(0).max(5).optional(),
}).optional();

const statsSchema = z.object({
    openJobsCount: z.number().int().min(0).optional(),
    totalJobsEverPosted: z.number().int().min(0).optional(),
}).optional();

const sponsorshipSchema = z.object({
    tier: z.enum(SPONSORSHIP_TIER).optional(),
    activeUntil: z.string().datetime().optional(),
}).optional();

const seoSchema = z.object({
    metaTitle: z.string().optional(),
    metaDescription: z.string().optional(),
    ogImage: z.string().optional(),
}).optional();

const createCompanyV2Schema = z.object({
    companyName: z.string().min(1).max(200),
    slug: z.string().max(100).optional(),

    logo: logoSchema,
    description: descriptionSchema,

    companyType: z.enum(COMPANY_TYPE).nullable().optional(),
    industry: z.string().optional(),
    tags: z.array(z.string()).optional(),
    techStack: z.array(z.string()).optional(),

    headquarters: z.string().optional(),
    locations: z.array(z.string()).optional(),

    foundedYear: z
        .number()
        .int()
        .min(1800)
        .max(new Date().getFullYear())
        .optional(),
    employeeCount: z.enum(EMPLOYEE_COUNT).nullable().optional(),
    website: z.string().optional(),

    careerPageLink: z.string().optional(),
    socialLinks: socialLinksSchema,

    ratings: ratingsSchema,
    stats: statsSchema,

    status: z.enum(COMPANY_STATUS).optional(),
    isVerified: z.boolean().optional(),
    sponsorship: sponsorshipSchema,

    seo: seoSchema,
});

const updateCompanyV2Schema = createCompanyV2Schema.partial();

const listCompanyV2QuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    status: z.enum(COMPANY_STATUS).optional(),
    search: z.string().max(200).optional(),
    industry: z.string().max(200).optional(),
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
    createCompanyV2Schema,
    updateCompanyV2Schema,
    listCompanyV2QuerySchema,
    validate,
    validateQuery,
    COMPANY_STATUS,
};
