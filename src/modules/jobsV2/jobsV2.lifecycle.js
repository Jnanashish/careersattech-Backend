const JobV2 = require("./jobsV2.model");

// Reason codes stored in `archivedReason`. "manual" = an admin archived it from
// the panel; "auto-verification-expired" = the apply-link verifier found the
// link dead. Kept here so admin + verifier never drift on the string.
const MANUAL_ARCHIVE_REASON = "manual";
const AUTO_EXPIRY_REASON = "auto-verification-expired";

/**
 * The exact field set written when a job is archived. Single source of truth so
 * the admin archive endpoint and the verifier produce identical documents.
 *
 * The verifier writes through a batched `bulkWrite` (one round-trip for the
 * whole scan), so it merges THESE fields into its update rather than calling
 * `archiveJob` per row — same shape, no per-doc query.
 *
 * @param {string} reason  one of MANUAL_ARCHIVE_REASON / AUTO_EXPIRY_REASON
 * @param {Date}   [now]   timestamp to stamp (verifier reuses one Date per scan)
 */
function buildArchiveFields(reason, now = new Date()) {
    return { status: "archived", archivedAt: now, archivedReason: reason };
}

/**
 * The exact field set written when an archived job is restored. Jobs have no
 * "active" status (that's the company enum) — the live state is "published".
 */
function buildRestoreFields() {
    return { status: "published", archivedAt: null, archivedReason: null };
}

/**
 * Archive a (non-deleted) job: status → "archived", stamp archivedAt +
 * archivedReason. Does NOT set deletedAt, so the public detail endpoint can
 * still resolve the job and render an "expired" state.
 *
 * @returns {Promise<import("mongoose").Document|null>} updated doc, or null if
 *   no non-deleted job with that id exists.
 */
async function archiveJob(id, reason = MANUAL_ARCHIVE_REASON) {
    return JobV2.findOneAndUpdate(
        { _id: id, deletedAt: null },
        { $set: buildArchiveFields(reason) },
        { new: true }
    );
}

/**
 * Restore an archived (non-deleted) job back to "published".
 *
 * @returns {Promise<import("mongoose").Document|null>} updated doc, or null if
 *   the job doesn't exist, is soft-deleted, or isn't currently archived.
 */
async function restoreJob(id) {
    return JobV2.findOneAndUpdate(
        { _id: id, deletedAt: null, status: "archived" },
        { $set: buildRestoreFields() },
        { new: true }
    );
}

module.exports = {
    archiveJob,
    restoreJob,
    buildArchiveFields,
    buildRestoreFields,
    MANUAL_ARCHIVE_REASON,
    AUTO_EXPIRY_REASON,
};
