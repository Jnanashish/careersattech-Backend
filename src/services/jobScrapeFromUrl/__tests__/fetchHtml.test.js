jest.mock("axios");
const axios = require("axios");

const {
    fetchHtml,
    FetchBlockedError,
    FetchFailedError,
    FetchTooLargeError,
    FetchTimeoutError,
} = require("../fetchHtml");

const URL = "https://example.com/job/123";

beforeEach(() => {
    axios.get.mockReset();
});

function ok(body, { status = 200, headers = { "content-type": "text/html" }, finalUrl } = {}) {
    return {
        status,
        data: body,
        headers,
        request: { res: { responseUrl: finalUrl || URL } },
    };
}

describe("fetchHtml", () => {
    test("200 returns html + finalUrl + status + contentType", async () => {
        axios.get.mockResolvedValueOnce(ok("<html>ok</html>"));
        const r = await fetchHtml(URL);
        expect(r.html).toBe("<html>ok</html>");
        expect(r.status).toBe(200);
        expect(r.contentType).toMatch(/text\/html/);
        expect(r.finalUrl).toBe(URL);
    });

    test("403 throws FetchBlockedError", async () => {
        axios.get.mockResolvedValueOnce(ok("forbidden", { status: 403 }));
        await expect(fetchHtml(URL)).rejects.toBeInstanceOf(FetchBlockedError);
    });

    test("429 throws FetchBlockedError", async () => {
        axios.get.mockResolvedValueOnce(ok("rate limited", { status: 429 }));
        await expect(fetchHtml(URL)).rejects.toBeInstanceOf(FetchBlockedError);
    });

    test("Cloudflare challenge page throws FetchBlockedError", async () => {
        axios.get.mockResolvedValueOnce(ok("<html>Just a moment...</html>", { status: 200 }));
        await expect(fetchHtml(URL)).rejects.toBeInstanceOf(FetchBlockedError);
    });

    test("500 throws FetchFailedError", async () => {
        axios.get.mockResolvedValueOnce(ok("server error", { status: 500 }));
        await expect(fetchHtml(URL)).rejects.toBeInstanceOf(FetchFailedError);
    });

    test("timeout throws FetchTimeoutError", async () => {
        const err = new Error("timeout");
        err.code = "ECONNABORTED";
        axios.get.mockRejectedValueOnce(err);
        await expect(fetchHtml(URL)).rejects.toBeInstanceOf(FetchTimeoutError);
    });

    test("oversize body throws FetchTooLargeError (axios code)", async () => {
        const err = new Error("maxContentLength size of x exceeded");
        err.code = "ERR_FR_MAX_CONTENT_LENGTH_EXCEEDED";
        axios.get.mockRejectedValueOnce(err);
        await expect(fetchHtml(URL)).rejects.toBeInstanceOf(FetchTooLargeError);
    });

    test("oversize body throws FetchTooLargeError (length check)", async () => {
        const big = "a".repeat(2_000);
        axios.get.mockResolvedValueOnce(ok(big));
        await expect(fetchHtml(URL, { maxBytes: 1_000 })).rejects.toBeInstanceOf(FetchTooLargeError);
    });

    test("network error throws FetchFailedError", async () => {
        const err = new Error("ENOTFOUND");
        err.code = "ENOTFOUND";
        axios.get.mockRejectedValueOnce(err);
        await expect(fetchHtml(URL)).rejects.toBeInstanceOf(FetchFailedError);
    });

    test("redirect chain: returns finalUrl from response.request.res.responseUrl", async () => {
        const finalUrl = "https://example.com/redirected";
        axios.get.mockResolvedValueOnce(ok("<html>final</html>", { finalUrl }));
        const r = await fetchHtml(URL);
        expect(r.finalUrl).toBe(finalUrl);
    });
});
