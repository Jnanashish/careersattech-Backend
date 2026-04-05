module.exports = {
    name: "freshershunt",
    displayName: "FreshersHunt",
    baseUrl: "https://freshershunt.in",
    enabled: true,

    selectors: {
        jobLinks: {
            selector: "a.fh-job-row",
            attribute: "href",
            limit: 10,
        },
        companyUrl: {
            selector: 'a[target="_blank"][rel="noopener"]:contains("Apply Now")',
            attribute: "href",
            fallbackSelector: 'div[style*="text-align: center"] a[target="_blank"]',
        },
        meta: {
            title: "h1.entry-title",
            company: null,
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

    notes: "Popular fresher job aggregator with IT/software focus.",
};
