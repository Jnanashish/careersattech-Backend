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
            // No hiring-company element on the detail page — the only
            // /frontend-jobs/companies/ anchors there are the footer's static
            // "popular companies" nav (Google, Meta, Amazon...), which would
            // mislabel every job. The company name is in the h1 ("... At
            // Cognizant") for the transformer to read.
            company: null,
            // The page carries <time datetime="..."> with an exact timestamp,
            // but scrapeOne reads meta selectors as text, which would yield
            // "Posted 1 week ago" — vague enough to make the model guess a
            // wrong ISO date. datePosted is stamped at publish time anyway.
            postedDate: null,
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
        "JSON-LD JobPosting but do run 1000+ words of visible JD copy. Apply links all resolve to " +
        "linkedin.com/jobs/view/, so applyPlatform lands on 'linkedin' for every job from here.",
};
