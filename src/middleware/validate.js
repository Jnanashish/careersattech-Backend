function validateBody(schema) {
    return (req, res, next) => {
        const result = schema.safeParse(req.body);
        if (!result.success) {
            return res.status(400).json({ error: "Validation failed", details: result.error.flatten() });
        }
        req.validated = result.data;
        next();
    };
}

function validateQuery(schema) {
    return (req, res, next) => {
        const result = schema.safeParse(req.query);
        if (!result.success) {
            return res.status(400).json({ error: "Validation failed", details: result.error.flatten() });
        }
        req.validatedQuery = result.data;
        next();
    };
}

module.exports = { validateBody, validateQuery };
