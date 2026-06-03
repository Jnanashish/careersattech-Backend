/**
 * In-memory state for the admin-triggered apply-link verification scan.
 *
 * The scan hits external URLs with a per-domain throttle, so it runs in the
 * background (fire-and-forget) instead of blocking the HTTP response. This
 * singleton tracks whether a run is in flight and caches the last summary so
 * the admin UI can poll for completion.
 *
 * State is per-process and intentionally NOT persisted — the flagged review
 * queue itself lives in the DB (jobs_v2.verification.*) and is the source of
 * truth. Mirrors the scraper's in-memory `stopFlags` pattern.
 */

let running = false;
let startedAt = null;
let lastRun = null; // summary object returned by runVerification
let current = null; // in-flight promise (exposed for sequencing / tests)

function isRunning() {
    return running;
}

/** Mark a run as started. Call before kicking off the background promise. */
function begin() {
    running = true;
    startedAt = new Date();
}

/** Mark a run as finished, caching the summary (when one was produced). */
function finish(summary) {
    running = false;
    if (summary) lastRun = summary;
}

function setCurrent(promise) {
    current = promise;
}

/** The in-flight (or last) run promise; resolves after finish() has run. */
function getCurrent() {
    return current;
}

function snapshot() {
    return { running, startedAt, lastRun };
}

/** Test-only: clear all state between cases. */
function _reset() {
    running = false;
    startedAt = null;
    lastRun = null;
    current = null;
}

module.exports = {
    isRunning,
    begin,
    finish,
    setCurrent,
    getCurrent,
    snapshot,
    _reset,
};
