module.exports = {
    name: "talentd",
    displayName: "Talentd",
    // The listing lives at /jobs, not the site root — scrapeOne fetches
    // baseUrl directly to harvest job links.
    baseUrl: "https://www.talentd.in/jobs",
    enabled: true,

    selectors: {
        jobLinks: {
            // Each card on "Find Your Dream Job" is covered by a full-bleed
            // overlay anchor. Matching on the href alone is not enough: every
            // category, city and skill page also lives under /jobs/ (83 such
            // links on the page vs 10 real postings), so the aria-label —
            // which the site renders as "View <role> at <company>" for cards
            // and never for taxonomy links — is what separates them.
            selector: 'a[aria-label^="View "][href^="/jobs/"]',
            attribute: "href",
            limit: 10,
        },
        companyUrl: {
            // The detail page's "Apply Now" button is the only anchor that
            // leaves for the employer's own ATS. Verified against Greenhouse,
            // Workday, Oracle Careers, Keka and jobsyn postings.
            selector: 'a[target="_blank"]:contains("Apply Now")',
            attribute: "href",
            // If the button label ever changes, fall back to the first
            // outbound anchor that is not the site's own product links — the
            // header carries hire.talentd.in and a WhatsApp community invite,
            // and both would otherwise be picked up as the apply URL.
            fallbackSelector:
                'a[target="_blank"][rel="noopener noreferrer"]' +
                ':not([href*="talentd.in"]):not([href*="whatsapp.com"])',
        },
        meta: {
            title: "h1",
            // The company name is a link to its Talentd profile. Supplying it
            // lets the transformer match an existing CompanyV2 and switch to
            // the job-only prompt instead of regenerating company details.
            company: 'a[href^="/companies/"]',
            // No machine-readable date on the page — it renders "1 day ago"
            // as loose text, which is worse than telling the model nothing.
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
        "Indian fresher/intern job board. Server-rendered Next.js, so cheerio sees the cards. " +
        "List → internal JD page → external 'Apply Now', the same three-step flow as freshershunt " +
        "and offcampusjobs4u. Detail pages carry a full JSON-LD JobPosting, but scrapeOne strips " +
        "<script> before the transformer sees the page; the visible copy already runs 500-1100 " +
        "words, so the JD text does not depend on it.",
};
