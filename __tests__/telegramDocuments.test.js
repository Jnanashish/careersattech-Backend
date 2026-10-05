// A fake token, set before config loads (dotenv never overrides a set var), so
// nothing here can reach the real bot even if the axios mock were missing.
process.env.TELEGRAM_BOT_TOKEN = "test-token";

require("./setup");

jest.mock("axios", () => ({ post: jest.fn() }));

const axios = require("axios");
const config = require("../src/config");
const { sendDocuments } = require("../src/utils/telegram");

const file = (name) => ({
    filename: `${name}.jpg`,
    buffer: Buffer.from(`jpeg bytes of ${name}`),
    contentType: "image/jpeg",
});

const urlOf = (call) => call[0];
const formOf = (call) => call[1];

beforeEach(() => {
    axios.post.mockReset();
    axios.post.mockResolvedValue({ data: { ok: true } });
});

describe("sendDocuments", () => {
    it("posts several files as one album of documents", async () => {
        const ok = await sendDocuments([file("a"), file("b"), file("c")], "socialDigest");

        expect(ok).toBe(true);
        expect(axios.post).toHaveBeenCalledTimes(1);
        const [call] = axios.post.mock.calls;
        expect(urlOf(call)).toBe("https://api.telegram.org/bottest-token/sendMediaGroup");

        const form = formOf(call);
        expect(form.get("chat_id")).toBe(config.telegram.socialDigestChatId);
        expect(JSON.parse(form.get("media"))).toEqual([
            { type: "document", media: "attach://file0" },
            { type: "document", media: "attach://file1" },
            { type: "document", media: "attach://file2" },
        ]);
        expect(form.get("file1").name).toBe("b.jpg");
        expect(form.get("file1").type).toBe("image/jpeg");
        expect(Buffer.from(await form.get("file1").arrayBuffer()).toString()).toBe("jpeg bytes of b");
    });

    it("sends a lone file with sendDocument — an album needs two", async () => {
        await sendDocuments([file("only")], "socialDigest");

        const [call] = axios.post.mock.calls;
        expect(urlOf(call)).toBe("https://api.telegram.org/bottest-token/sendDocument");
        expect(formOf(call).get("document").name).toBe("only.jpg");
    });

    it("splits more than ten files into albums of at most ten", async () => {
        const files = Array.from({ length: 12 }, (_, i) => file(`f${i}`));

        await sendDocuments(files, "socialDigest");

        expect(axios.post).toHaveBeenCalledTimes(2);
        expect(JSON.parse(formOf(axios.post.mock.calls[0]).get("media"))).toHaveLength(10);
        expect(JSON.parse(formOf(axios.post.mock.calls[1]).get("media"))).toHaveLength(2);
    });

    it("returns false without throwing when Telegram refuses, and stops there", async () => {
        axios.post.mockRejectedValue(
            Object.assign(new Error("Request failed with status code 403"), {
                response: { data: { description: "Forbidden: bot is not a member of the channel chat" } },
            })
        );

        const files = Array.from({ length: 12 }, (_, i) => file(`f${i}`));

        await expect(sendDocuments(files, "socialDigest")).resolves.toBe(false);
        expect(axios.post).toHaveBeenCalledTimes(1);
    });

    it("returns false for an unknown channel without calling Telegram", async () => {
        await expect(sendDocuments([file("a")], "no-such-channel")).resolves.toBe(false);
        expect(axios.post).not.toHaveBeenCalled();
    });
});
