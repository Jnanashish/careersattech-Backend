// Ported from admin-panel/src/Helpers/JobListHelper/captionTemplates.js — ESM → CommonJS,
// content otherwise verbatim. The admin Daily Digest builds the same caption
// in the browser, so a change to one copy must be made to the other.

// =========================================================
// @careersattech — Caption Template Bank (Nov 2026)
// 7 rotating templates · placeholders below
// =========================================================
//
// PLACEHOLDERS:
//   {ROLE}         — role category, lowercase (e.g. "frontend")
//   {ROLE_CAP}     — capitalized (e.g. "Frontend")
//   {TECH}         — primary tech / language (e.g. "React.js")
//   {JOBS_LIST}    — formatted list, one job per line
//   {SAVE_CTA}     — rotating save/share CTA
//   {HASHTAGS}     — pulled from hashtagBank
// =========================================================

const captionTemplates = {
    alert: `Multiple companies are hiring freshers for Software Engineer posts 💻

━━━━━━━━━━━━━━━
{JOBS_LIST}
━━━━━━━━━━━━━━━

{SAVE_CTA}

Follow @careersattech — your daily tech job feed ⚡

{HASHTAGS}`,

    codeFocused: `🔥 Save this — companies are hiring software engineers right now.

━━━━━━━━━━━━━━━
{JOBS_LIST}
━━━━━━━━━━━━━━━

{SAVE_CTA}

Follow @careersattech for daily verified tech jobs ⚡

{HASHTAGS}`,

    curation: `💼 Top tech companies are hiring freshers for software roles this week.

━━━━━━━━━━━━━━━
{JOBS_LIST}
━━━━━━━━━━━━━━━

{SAVE_CTA}

Follow @careersattech for fresh job drops every day ⚡

{HASHTAGS}`,

    questionHook: `Looking for a fresher software engineer role? 👀

Multiple companies are hiring right now — check the openings below.

━━━━━━━━━━━━━━━
{JOBS_LIST}
━━━━━━━━━━━━━━━

{SAVE_CTA}

Follow @careersattech — verified tech job updates daily ⚡

{HASHTAGS}`,

    tier1: `🏆 Tier-1 tech companies are hiring freshers for software engineer roles.

These don't stay open long.

━━━━━━━━━━━━━━━
{JOBS_LIST}
━━━━━━━━━━━━━━━

{SAVE_CTA}

Follow @careersattech for verified tier-1 job alerts ⚡

{HASHTAGS}`,

    internship: `🎯 Paid software internships are open — multiple companies hiring freshers.

━━━━━━━━━━━━━━━
{JOBS_LIST}
━━━━━━━━━━━━━━━

{SAVE_CTA}

Follow @careersattech for daily internship + job updates ⚡

{HASHTAGS}`,

    spotlight: `📢 Multiple teams are hiring freshers for software engineer roles right now.

━━━━━━━━━━━━━━━
{JOBS_LIST}
━━━━━━━━━━━━━━━

{SAVE_CTA}

Follow @careersattech for company-specific drops ⚡

{HASHTAGS}`,
};

const TEMPLATE_OPTIONS = [
    { key: "alert", label: "Alert / urgency" },
    { key: "codeFocused", label: "Code-focused" },
    { key: "curation", label: "Weekly curation" },
    { key: "questionHook", label: "Question hook" },
    { key: "tier1", label: "Tier-1 / aspiration" },
    { key: "internship", label: "Internship" },
    { key: "spotlight", label: "Single-company spotlight" },
];

const SAVE_CTAS = [
    "Save this post — apply this weekend 📌",
    "Tag a friend who's on the job hunt 👇",
    "Save this and share with your batch 📌",
    "Send this to a friend who's been applying 👇",
    "Save now and apply this week 📌",
    "Tag someone who needs to see this 👇",
];

// =========================================================
// HASHTAG MAPPING — pull tag set per template + role
// =========================================================
const hashtagsByTemplate = {
    default: ({ techTags = [], companyTag, locationTag }) =>
        [
            ...techTags,
            companyTag,
            locationTag,
            "#offcampusdrive",
            "#placementdrive",
            "#freshershiring",
            "#2026batch",
            "#engineeringstudents",
            "#placementseason",
        ]
            .filter(Boolean)
            .slice(0, 10),

    internship: ({ techTags = [] }) =>
        [
            ...techTags.slice(0, 3),
            "#internshipsindia",
            "#freshersinternship",
            "#techinternship",
            "#internshipopportunity",
            "#engineeringstudents",
            "#2026batch",
            "#campusplacement",
        ].slice(0, 10),

    curation: () => [
        "#offcampusdrive",
        "#placementdrive",
        "#freshershiring",
        "#freshersjobs",
        "#fresherjobsindia",
        "#engineeringstudents",
        "#2026batch",
        "#campusplacement",
        "#placementseason",
        "#techjobsindia",
    ],
};

module.exports = {
    captionTemplates,
    TEMPLATE_OPTIONS,
    SAVE_CTAS,
    hashtagsByTemplate,
};
