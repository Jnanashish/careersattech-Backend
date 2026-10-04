// Ported from admin-panel/src/Helpers/JobListHelper/index.js (the "whatsapp"
// branch of messageTemplate, and buildWhatsAppMessage) plus the `translate`
// helper from Helpers/textTransform.js. The admin Daily Digest builds the same
// message in the browser, so a change to one copy must be made to the other.

// ASCII letter → its Unicode "Mathematical Sans-Serif Bold" equivalent, so the
// title reads as bold wherever the text is pasted.
const translate = (char) => {
    const diff = /[A-Z]/.test(char)
        ? "𝗔".codePointAt(0) - "A".codePointAt(0)
        : "𝗮".codePointAt(0) - "a".codePointAt(0);
    return String.fromCodePoint(char.codePointAt(0) + diff);
};

const stylize = (s = "") => s.replace(/[A-Za-z]/g, translate);

const formatList = (val) => (Array.isArray(val) ? val.join(", ") : val || "");

const getApplyLink = (item) => item?.applyLink || item?.link || "";

/**
 * One job's block. With `siteUrl` the link points at the job's page on the
 * site (the Daily Digest default); without it, at the employer's apply link.
 */
const whatsappTemplate = (item, siteUrl) => {
    const role = item?.title || item?.role || "";
    const link =
        siteUrl && item?.slug ? `${siteUrl}/jobs/${item.slug}` : getApplyLink(item);
    return (
        // v2 titles are the bare role ("Software Engineer"), so the company
        // needs a separator or the two run together.
        stylize([item?.companyName, role].filter(Boolean).join(" — ")) +
        "\nBatch : " + formatList(item?.batch) +
        "\nDegree : " + formatList(item?.degree) +
        "\n\nApply Here 👉 " + link
    );
};

const buildWhatsAppMessage = (jobs, { siteUrl } = {}) => {
    const list = Array.isArray(jobs) ? jobs : jobs ? [jobs] : [];
    return list
        .map((item, i) => `${i + 1}. ${whatsappTemplate(item, siteUrl)}\n\n`)
        .join("");
};

module.exports = {
    buildWhatsAppMessage,
    stylize,
};
