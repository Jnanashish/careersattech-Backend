const { _internals } = require("../jobsV2.public.controller");
const { isSafeRedirect } = _internals;

describe("applyRedirect isSafeRedirect", () => {
    test.each([
        "https://careers.google.com/jobs/123",
        "http://example.com/apply",
        "mailto:hr@example.com",
    ])("allows %s", (link) => {
        expect(isSafeRedirect(link)).toBe(true);
    });

    test.each([
        "javascript:alert(document.cookie)",
        "data:text/html,<script>alert(1)</script>",
        "file:///etc/passwd",
        "vbscript:msgbox(1)",
        "",
        null,
        undefined,
        "not a url",
    ])("blocks %s", (link) => {
        expect(isSafeRedirect(link)).toBe(false);
    });
});
