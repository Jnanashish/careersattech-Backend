// In-memory set of adapter names that have been requested to stop
const stopRequested = new Set();

function requestStop(adapterName) {
    stopRequested.add(adapterName);
}

function isStopRequested(adapterName) {
    return stopRequested.has(adapterName);
}

function clearStop(adapterName) {
    stopRequested.delete(adapterName);
}

function getAll() {
    return [...stopRequested];
}

module.exports = { requestStop, isStopRequested, clearStop, getAll };
