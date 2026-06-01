module.exports = {
    name: "freshersjobs",
    displayName: "FreshersJobs",
    baseUrl: "https://freshers.jobs",
    enabled: true,

    selectors: {
        jobLinks: {
            selector: "h2.entry-title a",
            attribute: "href",
            limit: 10,
        },
        companyUrl: {
            // Apply link is an <a> wrapping <button class="button-color">Click Here to Apply</button>.
            // It is the first such button on the page; the other "button-color" buttons are
            // internal course-promo links on freshers.jobs.
            selector: "a:has(button.button-color)",
            attribute: "href",
            fallbackSelector: null,
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

    notes:
        "WordPress/Elementor off-campus fresher aggregator (India). Homepage lists latest jobs in " +
        "h2.entry-title; detail pages carry the real apply link in the first button-color anchor.",
};
