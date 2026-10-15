// Ported from admin-panel/src/Helpers/JobListHelper/index.js (the "whatsapp"
// branch of messageTemplate, and buildWhatsAppMessage). The admin Daily Digest
// builds the same message in the browser, so a change to one copy must be made
// to the other.
//
// Bold uses WhatsApp's native *text* markup, not Unicode bold letters, so the
// company names stay searchable in the channel and readable by screen readers.

const SITE_HOST = "careersat.tech";

const formatList = (val) => (Array.isArray(val) ? val.join(", ") : val || "");

const formatBatch = (val) =>
    (Array.isArray(val) ? [...val] : val ? [val] : [])
        .map(Number)
        .filter(Number.isFinite)
        .sort((a, b) => a - b)
        .join(", ");

const formatDegree = (val) => formatList(val) || "Any Graduate";

const formatLocation = (item) => {
    const places = (Array.isArray(item?.jobLocation) ? item.jobLocation : [])
        .map((l) => l?.city || l?.region)
        .filter(Boolean);
    if (item?.workMode === "remote") places.push("Remote");
    return [...new Set(places)].join(" / ");
};

const formatDate = (date = new Date()) =>
    new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata",
        day: "numeric",
        month: "short",
        year: "numeric",
    }).format(date);

const getApplyLink = (item) => item?.applyLink || item?.link || "";

/**
 * One job's block. With `siteUrl` the link points at the job's page on the
 * site (the Daily Digest default); without it, at the employer's apply link.
 */
const whatsappTemplate = (item, siteUrl, number) => {
    const role = item?.title || item?.role || "";
    const link =
        siteUrl && item?.slug ? `${siteUrl}/jobs/${item.slug}` : getApplyLink(item);
    // v2 titles are the bare role ("Software Engineer"), so the company
    // needs a separator or the two run together.
    const title = [item?.companyName, role].filter(Boolean).join(" — ");
    const location = formatLocation(item);
    return [
        `*${number ? `${number}. ` : ""}${title}*`,
        location && `Location: ${location}`,
        `Batch: ${formatBatch(item?.batch)}`,
        `Degree: ${formatDegree(item?.degree)}`,
        `Apply: ${link}`,
    ]
        .filter(Boolean)
        .join("\n");
};

// The header puts the site link first so WhatsApp builds the preview card
// from it rather than from the first job's apply link.
const buildWhatsAppMessage = (jobs, { siteUrl, now = new Date() } = {}) => {
    const list = Array.isArray(jobs) ? jobs : jobs ? [jobs] : [];
    if (!list.length) return "";
    const header =
        `*Tech Jobs for Freshers — ${formatDate(now)}*\n` +
        `${list.length} handpicked ${list.length === 1 ? "role" : "roles"} | Full list: ${SITE_HOST}/jobs`;
    const blocks = list.map((item, i) => whatsappTemplate(item, siteUrl, i + 1));
    const footer =
        "━━━━━━━━━━━━━━\n" +
        `More jobs daily: ${SITE_HOST}/jobs\n` +
        "Share this channel with a friend who's job hunting";
    return [header, ...blocks, footer].join("\n\n");
};

module.exports = {
    buildWhatsAppMessage,
};
