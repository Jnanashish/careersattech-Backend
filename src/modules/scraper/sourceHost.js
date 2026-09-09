// Host comparison for a single question: does this apply link send the
// candidate to the employer, or does it loop back to the board we lifted the
// posting from?
//
// The transformer LLM is what picks `applyLink`, and the URLs it can see are
// the aggregator permalink and whatever outbound link the adapter extracted.
// Nothing in the page text says which is which — FrontendGeek's apply button
// points at LinkedIn, whose page we deliberately never fetch, so the model has
// only two bare URLs to choose between and sometimes echoes the permalink. The
// result is a published job whose Apply button returns to FrontendGeek.
//
// Both the transform-time guard (transformer.normalizeJob) and the publish
// gate (publisher.validatePublishReadiness) compare against the adapter's own
// `baseUrl` host, stamped onto every raw job as `sourceHost`. That is
// deliberately NOT the host of `sourceUrl`: adapters reading a structured API
// (engineerhub, peerlist) set `sourceUrl` to the apply link itself, so
// comparing against it would reject every job they produce.

/**
 * Registrable host of a URL, lowercased and stripped of a leading "www.".
 * Accepts a bare host ("frontendgeek.com") as well as a full URL. Returns ""
 * for anything without one — including mailto: links, which carry no host.
 */
function hostOf(value) {
    if (!value || typeof value !== "string") return "";
    const trimmed = value.trim();
    if (!trimmed) return "";
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
        return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
        return "";
    }
}

/**
 * Same site, not merely the same string: a board may serve its permalinks from
 * the apex and its API or CDN from a subdomain, and both are still "back to
 * the aggregator" for our purposes.
 */
function isSameSite(a, b) {
    if (!a || !b) return false;
    return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/**
 * True when `url` points back at the site named by `sourceHost`.
 *
 * An unknown `sourceHost` returns false. That fail-open is deliberate and load
 * bearing: staging rows written before `sourceHost` existed carry no value,
 * and a missing field must never start rejecting apply links we cannot judge.
 */
function pointsAtSourceSite(url, sourceHost) {
    return isSameSite(hostOf(url), hostOf(sourceHost));
}

module.exports = { hostOf, isSameSite, pointsAtSourceSite };
