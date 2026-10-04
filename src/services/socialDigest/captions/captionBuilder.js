// Ported from admin-panel/src/Helpers/JobListHelper/captionBuilder.js — ESM → CommonJS,
// content otherwise verbatim. The admin Daily Digest builds the same caption
// in the browser, so a change to one copy must be made to the other.

const { hashtagBank } = require("./hashtagBank");
const {
    captionTemplates,
    hashtagsByTemplate,
    SAVE_CTAS,
} = require("./captionTemplates");
const { deriveInsights, pickTemplate } = require("./jobInsights");

// Instagram allows only 5 hashtags per post.
const MAX_HASHTAGS = 5;

// De-dupe + cap a whitespace-separated hashtag string to MAX_HASHTAGS.
const capHashtags = (str) =>
    Array.from(new Set(str.split(/\s+/).filter(Boolean)))
        .slice(0, MAX_HASHTAGS)
        .join(" ");

const pickHashtagsString = (insights, templateKey) => {
    const techTags = (hashtagBank.techStack[insights.role] ||
        hashtagBank.techStack.generic).slice(0, 4);

    const companyTagArr =
        insights.companyKeys.length === 1
            ? hashtagBank.company[insights.companyKeys[0]] || []
            : [];
    const companyTag = companyTagArr[0];

    const locationTagArr =
        insights.cityKeys.length === 1
            ? hashtagBank.location[insights.cityKeys[0]] || []
            : [];
    const locationTag = locationTagArr[0];

    const mapper =
        hashtagsByTemplate[templateKey] || hashtagsByTemplate.default;
    const tags = mapper({ techTags, companyTag, locationTag, insights });
    return capHashtags(Array.from(new Set(tags)).join(" "));
};

const pickSaveCta = (insights) => {
    const seed =
        (insights.count + (insights.companies.charCodeAt(0) || 0)) %
        SAVE_CTAS.length;
    return SAVE_CTAS[seed];
};

const buildCaption = ({
    jobs = [],
    templateKey,
    customHashtags,
} = {}) => {
    const list = Array.isArray(jobs) ? jobs : [];
    if (!list.length) return "";

    const insights = deriveInsights(list);
    const finalTemplateKey = templateKey || pickTemplate(insights);
    const hashtags =
        typeof customHashtags === "string" && customHashtags.trim()
            ? capHashtags(customHashtags.trim())
            : pickHashtagsString(insights, finalTemplateKey);

    const baseTemplate =
        captionTemplates[finalTemplateKey] || captionTemplates.alert;

    const replacements = {
        "{COUNT}": String(insights.count),
        "{ROLE}": insights.role,
        "{ROLE_CAP}": insights.roleCap,
        "{TECH}": insights.tech,
        "{COMPANIES}": insights.companies || "",
        "{JOBS_LIST}": insights.jobsList || "",
        "{SAVE_CTA}": pickSaveCta(insights),
        "{HASHTAGS}": hashtags,
    };

    let out = baseTemplate;
    for (const [token, value] of Object.entries(replacements)) {
        out = out.split(token).join(value);
    }

    return out;
};

module.exports = {
    buildCaption,
};
