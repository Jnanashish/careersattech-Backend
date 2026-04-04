module.exports = {
    name: "freshershunt",
    displayName: "FreshersHunt",
    baseUrl: "https://www.freshershunt.com",
    enabled: true,

    selectors: {
        jobLinks: {
            selector: "TODO_SELECTOR",
            attribute: "href",
            limit: 20,
        },
        companyUrl: {
            selector: "TODO_SELECTOR",
            attribute: "href",
            fallbackSelector: null,
        },
        meta: {
            title: "TODO_SELECTOR",
            company: "TODO_SELECTOR",
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
