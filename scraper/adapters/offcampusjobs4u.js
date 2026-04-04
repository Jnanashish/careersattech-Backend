module.exports = {
    name: "offcampusjobs4u",
    displayName: "OffCampusJobs4u",
    baseUrl: "https://offcampusjobs4u.com",
    enabled: true,

    selectors: {
        jobLinks: {
            selector: ".entry-title.td-module-title a",
            attribute: "href",
            limit: 2,
        },
        companyUrl: {
            selector: ".td-post-content a[target='_blank'][rel='noopener noreferrer']",
            attribute: "href",
            fallbackSelector: null,
        },
        meta: {
            title: "h1.tdb-title-text",
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

    notes: "One of the largest fresher job aggregators. Posts 10-20 new jobs daily.",
};
