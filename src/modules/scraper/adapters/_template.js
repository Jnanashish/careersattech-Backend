/**
 * ADAPTER TEMPLATE
 * ================
 * Copy this file and rename it to add a new scraper source.
 *
 * HOW TO FILL IN SELECTORS:
 *
 * 1. Open the website in Chrome
 * 2. Right-click on a job title link → Inspect Element
 *    → Note the CSS selector path → Put it in selectors.jobLinks.selector
 *
 * 3. Click into any job post → Right-click on the "Apply" button → Inspect
 *    → Note the selector → Put it in selectors.companyUrl.selector
 *
 * 4. On the same job post page:
 *    → Right-click the job title → Inspect → selectors.meta.title
 *    → Right-click the company name → Inspect → selectors.meta.company
 *    → Right-click the posted date → Inspect → selectors.meta.postedDate
 *
 * 5. Test it: node scraper/test-adapter.js your-adapter-name
 *
 * TIPS FOR FINDING SELECTORS:
 * - In Chrome DevTools, right-click an element → Copy → Copy selector
 * - Prefer class-based selectors: ".post-title a" over "div > div > h2 > a"
 * - Test your selector in Chrome console: document.querySelectorAll("your-selector")
 * - If the site uses dynamic rendering (React/Next.js), cheerio may not work
 *   → In that case, note it in the comments and we'll handle it differently
 */

module.exports = {
    name: "your-site-name",
    displayName: "Your Site Name",
    baseUrl: "https://example.com",
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
        // OPTIONAL. Omit it and the whole page (minus nav/header/footer) is sent
        // to the LLM. Add it when the posting is a small island in a big page —
        // mega-menus, ad slots, "related jobs" rails. That padding is not just
        // expensive, it is wrong: related-job cards carry other employers'
        // descriptions, and the model can pick the wrong company off them.
        //
        //   selector: wrapper holding the posting. If it matches several nodes
        //             (nested ancestors, repeated utility classes), the ones
        //             containing `anchor` win, then the largest of those.
        //   remove:   sub-trees dropped before reading text. Nodes *inside* the
        //             wrapper that are not part of the posting go here.
        //   anchor:   defaults to selectors.meta.title.
        //
        // content: {
        //     selector: "div.job-body",
        //     remove: ["article", ".related-jobs"],
        // },
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

    notes: "",
};
