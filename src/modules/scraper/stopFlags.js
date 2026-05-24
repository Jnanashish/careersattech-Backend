// In-memory set of adapter names that have been requested to stop.
// Stop is cooperative: an adapter polls isStopRequested() during its run.
// Flags auto-expire after AUTO_CLEAR_MS so a stop pressed while nothing is
// running does not silently abort the next scheduled run.
const AUTO_CLEAR_MS = 5 * 60 * 1000;

const stopRequested = new Set();
const autoClearTimers = new Map();

function requestStop(adapterName) {
    stopRequested.add(adapterName);
    const prev = autoClearTimers.get(adapterName);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
        stopRequested.delete(adapterName);
        autoClearTimers.delete(adapterName);
    }, AUTO_CLEAR_MS);
    if (typeof timer.unref === "function") timer.unref();
    autoClearTimers.set(adapterName, timer);
}

function isStopRequested(adapterName) {
    return stopRequested.has(adapterName);
}

function clearStop(adapterName) {
    stopRequested.delete(adapterName);
    const timer = autoClearTimers.get(adapterName);
    if (timer) {
        clearTimeout(timer);
        autoClearTimers.delete(adapterName);
    }
}

function getAll() {
    return [...stopRequested];
}

module.exports = { requestStop, isStopRequested, clearStop, getAll, AUTO_CLEAR_MS };
