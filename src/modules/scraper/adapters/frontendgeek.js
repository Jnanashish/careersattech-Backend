module.exports = {
    name: "frontendgeek",
    displayName: "FrontendGeek",
    // The explore feed, not the site root — scrapeOne fetches baseUrl directly
    // to harvest job links.
    baseUrl: "https://frontendgeek.com/frontend-jobs/explore",
    enabled: true,

    selectors: {
        jobLinks: {
            // Postings live under /frontend-jobs/view/; the company, location
            // and skill hubs sit under sibling /frontend-jobs/* paths, so the
            // /view/ segment is what separates a job from a taxonomy page.
            //
            // Scoping to h3 also collapses the duplicate: each card renders the
            // same href twice, once as the title and once as a "View job"
            // button (861 anchors for 429 jobs). The h3 is the title copy.
            selector: 'h3 a[href^="/frontend-jobs/view/"]',
            attribute: "href",
            // Only the newest six, as briefed. The feed is ordered newest-first
            // — verified by reading the <time datetime> on every card and
            // confirming the first six in DOM order are the six most recent —
            // so taking the head of the list is taking the latest postings.
            limit: 6,
        },
        companyUrl: {
            // Every posting's apply button points at the LinkedIn job page it
            // was sourced from; this site does not carry employer ATS links.
            selector: 'a[target="_blank"]:contains("Apply Now")',
            attribute: "href",
            // Deliberately narrow. The generic "first outbound anchor" shape
            // used by the other adapters is actively wrong here: the header
            // ships X, YouTube and Quora links, and a footer full of directory
            // backlinks, all target="_blank" rel="noopener noreferrer" and all
            // ahead of the apply button. Matching the LinkedIn job URL itself
            // is the only fallback that cannot pick up a social link.
            fallbackSelector: 'a[href*="linkedin.com/jobs/view/"]',
        },
        meta: {
            title: "h1",
            // The employer name sits in the posting header, in the uppercase
            // eyebrow <p> directly above the h1. Anchoring on :has(h1) is what
            // makes this safe: the site nav is also a <header>, comes first in
            // document order, and would otherwise win .first(). Do NOT reach
            // for /frontend-jobs/companies/ anchors — the only ones on a detail
            // page are the footer's static "popular companies" nav (Google,
            // Meta, Amazon...), which would label every job "Google".
            //
            // Supplying this is what lets the transformer match an existing
            // CompanyV2 and switch to the job-only prompt, which is ~480 tokens
            // smaller than the full company-enrichment one.
            company: "header:has(h1) p.uppercase",
            // The page carries <time datetime="..."> with an exact timestamp,
            // but scrapeOne reads meta selectors as text, which would yield
            // "Posted 1 week ago" — vague enough to make the model guess a
            // wrong ISO date. datePosted is stamped at publish time anyway.
            postedDate: null,
        },
        // The posting itself is ~500 characters inside a 10-30KB page. Without
        // scoping, a whole-page strip ships the tools mega-menu (every
        // "YouTube to MP3 Converter" in the catalogue), the ad slots, and a
        // "More related jobs" rail — which is worse than bulk, because those
        // cards carry other employers' full descriptions right beside the real
        // one. Whole-page prompts here measured 8.1-9.3K tokens and were
        // rejected outright by the provider's per-minute cap; scoped, the same
        // pages come in around 900-1100 characters.
        //
        // The related-job cards are <article> elements inside the wrapper, so
        // they have to be removed explicitly — scoping alone does not drop them.
        content: {
            selector: "div.min-w-0.flex-1",
            remove: ["article"],
        },
    },

    options: {
        delayMs: 2000,
        headers: {},
        pagination: {
            enabled: false,
            nextPageSelector: null,
            maxPages: 1,
        },
    },

    notes:
        "Frontend-focused Indian job board. Server-rendered Next.js: the explore feed ships the " +
        "whole catalogue (~429 postings) in one ~5MB document with no public API behind it, so " +
        "each run pays for that page before slicing the newest six. Detail pages carry no " +
        "JSON-LD JobPosting; the posting itself is a condensed ~500-word summary buried in 10-30KB " +
        "of menus, ads and related-job cards, hence selectors.content. Apply links all resolve to " +
        "linkedin.com/jobs/view/, so applyPlatform lands on 'linkedin' for every job from here — " +
        "and that host is login-walled, so scrapeOne skips fetching companyPageContent for it.",
};
