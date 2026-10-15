// Ported from admin-panel/src/Helpers/JobListHelper/captionBuilder.js — ESM → CommonJS,
// content otherwise verbatim. The admin panel builds the same caption in the
// browser, so a change to one copy must be made to the other.

const { CAPTION_FORMATS, isFormatEligible, pickFormat } = require("./captionTemplates");

// Instagram allows only 5 hashtags per post.
const MAX_HASHTAGS = 5;

// De-dupe + cap a list of hashtags to MAX_HASHTAGS.
const capHashtags = (tags) =>
    Array.from(new Set(tags.filter(Boolean)))
        .slice(0, MAX_HASHTAGS)
        .join(" ");

/**
 * Build an Instagram caption. With no `templateKey` (or one the jobs aren't
 * eligible for) the format comes from the weekday rotation in pickFormat.
 */
const buildCaption = ({
    jobs = [],
    templateKey,
    customHashtags,
    now = new Date(),
} = {}) => {
    const list = Array.isArray(jobs) ? jobs : [];
    if (!list.length) return "";

    const key =
        templateKey && isFormatEligible(templateKey, list)
            ? templateKey
            : pickFormat(list, now);
    const { body, hashtags } = CAPTION_FORMATS[key].build(list);

    const tags =
        typeof customHashtags === "string" && customHashtags.trim()
            ? capHashtags(customHashtags.trim().split(/\s+/))
            : capHashtags(hashtags);

    return tags ? `${body}\n\n${tags}` : body;
};

module.exports = {
    buildCaption,
};
