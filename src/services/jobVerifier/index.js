const { verifyApplyUrl } = require("./genericVerifier");

/**
 * Higher-level wrapper around `verifyApplyUrl` that takes a JobV2 doc and
 * returns the verification result plus a recommended action.
 *
 * @param {{ applyLink?: string }} jobDoc
 * @returns {Promise<import("./genericVerifier").VerificationResult & { shouldArchive: boolean, archiveReason: string|null }>}
 */
async function verifyJob(jobDoc) {
    const url = jobDoc && jobDoc.applyLink;
    const verification = await verifyApplyUrl(url);
    const shouldArchive = verification.result === "expired";
    return {
        ...verification,
        shouldArchive,
        archiveReason: shouldArchive ? "auto-verification-expired" : null,
    };
}

module.exports = {
    verifyApplyUrl,
    verifyJob,
};
