const { randomUUID } = require("crypto");
const { z } = require("zod");
const { scrapeAndCreateJob } = require("../../services/jobScrapeFromUrl");
const {
    FetchBlockedError,
    FetchFailedError,
    FetchTooLargeError,
    FetchTimeoutError,
} = require("../../services/jobScrapeFromUrl/fetchHtml");
const { ExtractionFailedError } = require("../../services/jobScrapeFromUrl/extractJobFields");
const logger = require("../../utils/logger");

const scrapeAndPostSchema = z.object({
    applyLink: z.string().url().max(2000),
});

function logFailure({ requestId, applyLink, errorCode, message }) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({
        kind: "scrape_and_post_failure",
        requestId,
        applyLink,
        errorCode,
        message,
    }));
}

exports.scrapeAndPostSchema = scrapeAndPostSchema;

exports.scrapeAndPost = async (req, res) => {
    const requestId = randomUUID();
    const { applyLink } = req.validated;
    const postedBy = req.firebaseUser?.uid || req.firebaseUser?.email || "admin";

    try {
        const result = await scrapeAndCreateJob({ applyLink, postedBy });

        if (result.ok) {
            return res.status(201).json({
                requestId,
                data: result.job,
                confidence: result.confidence,
                warnings: result.warnings,
                companyWasCreated: result.companyWasCreated,
            });
        }

        if (result.errorCode === "DUPLICATE") {
            logFailure({ requestId, applyLink, errorCode: "DUPLICATE", message: "Job with applyLink exists" });
            return res.status(409).json({
                requestId,
                errorCode: "DUPLICATE",
                error: "Job with this applyLink already exists",
                existingJob: result.existingJob,
            });
        }

        if (result.errorCode === "VALIDATION_FAILED") {
            logFailure({
                requestId,
                applyLink,
                errorCode: "VALIDATION_FAILED",
                message: JSON.stringify(result.validationErrors),
            });
            return res.status(422).json({
                requestId,
                errorCode: "VALIDATION_FAILED",
                error: "Extracted job failed schema validation",
                partialExtraction: result.partialExtraction,
                validationErrors: result.validationErrors,
            });
        }

        logFailure({ requestId, applyLink, errorCode: "UNKNOWN", message: "Unknown orchestrator result" });
        return res.status(500).json({ requestId, errorCode: "UNKNOWN", error: "Unknown error" });
    } catch (err) {
        if (err instanceof FetchBlockedError) {
            logFailure({ requestId, applyLink, errorCode: "FETCH_BLOCKED", message: err.message });
            return res.status(502).json({
                requestId,
                errorCode: "FETCH_BLOCKED",
                error: err.message,
                suggestedAction: "manual_paste",
            });
        }
        if (err instanceof FetchTimeoutError) {
            logFailure({ requestId, applyLink, errorCode: "FETCH_TIMEOUT", message: err.message });
            return res.status(502).json({ requestId, errorCode: "FETCH_TIMEOUT", error: err.message });
        }
        if (err instanceof FetchTooLargeError) {
            logFailure({ requestId, applyLink, errorCode: "FETCH_TOO_LARGE", message: err.message });
            return res.status(502).json({ requestId, errorCode: "FETCH_TOO_LARGE", error: err.message });
        }
        if (err instanceof FetchFailedError) {
            logFailure({ requestId, applyLink, errorCode: "FETCH_FAILED", message: err.message });
            return res.status(502).json({ requestId, errorCode: "FETCH_FAILED", error: err.message });
        }
        if (err instanceof ExtractionFailedError) {
            logFailure({ requestId, applyLink, errorCode: "EXTRACTION_FAILED", message: err.message });
            return res.status(422).json({
                requestId,
                errorCode: "EXTRACTION_FAILED",
                error: err.message,
                rawResponseSnippet: typeof err.rawResponse === "string"
                    ? err.rawResponse.slice(0, 500)
                    : undefined,
            });
        }

        logFailure({ requestId, applyLink, errorCode: "INTERNAL", message: err.message });
        logger.error(`scrapeAndPost internal error: ${err.stack || err.message}`);
        return res.status(500).json({ requestId, errorCode: "INTERNAL", error: "Internal server error" });
    }
};
