// Real renders: satori → resvg → sharp, with only the logo download mocked.
jest.mock("axios", () => ({ get: jest.fn() }));

const axios = require("axios");
const sharp = require("sharp");
const {
    renderBanners,
    loadLogo,
    _internals: { detailLines, isAllowedLogoUrl, WIDTH, HEIGHT, SCALE },
} = require("../src/services/socialDigest/banner");

const CDN_LOGO = "https://res.cloudinary.com/demo/image/upload/v1/logo.png";

const job = (overrides = {}) => ({
    _id: "65f000000000000000000001",
    slug: "acme-software-engineer",
    title: "Software Engineer",
    companyName: "Acme",
    experience: { min: 0, max: 2 },
    jobLocation: [{ city: "Bengaluru" }],
    company: { companyName: "Acme", logo: { banner: CDN_LOGO } },
    ...overrides,
});

let logoPng;
beforeAll(async () => {
    logoPng = await sharp({
        create: { width: 400, height: 100, channels: 4, background: "#e11d48" },
    })
        .png()
        .toBuffer();
});

beforeEach(() => {
    axios.get.mockReset();
    axios.get.mockResolvedValue({ data: logoPng });
});

const sizeOf = async (buffer) => {
    const { width, height, format } = await sharp(buffer).metadata();
    return { width, height, format };
};

describe("banner renderer", () => {
    it("renders a 2160×2700 JPEG named after the job", async () => {
        const [result] = await renderBanners([job()]);

        expect(result.file.filename).toBe("acme-software-engineer.jpg");
        expect(result.file.contentType).toBe("image/jpeg");
        expect(await sizeOf(result.file.buffer)).toEqual({
            width: WIDTH * SCALE,
            height: HEIGHT * SCALE,
            format: "jpeg",
        });
        expect(axios.get).toHaveBeenCalledWith(CDN_LOGO, expect.objectContaining({ maxRedirects: 0 }));
    });

    it("falls back to the company name when the logo download fails", async () => {
        axios.get.mockRejectedValue(new Error("timeout of 8000ms exceeded"));

        const [result] = await renderBanners([job()]);

        expect(result.file).not.toBeNull();
        expect((await sizeOf(result.file.buffer)).width).toBe(WIDTH * SCALE);
    });

    it("renders one file per job, in order, through long titles and missing details", async () => {
        const results = await renderBanners([
            job(),
            job({
                slug: "long-title",
                title: "Senior Associate Software Development Engineer, Platform Infrastructure (Early Career)",
                experience: undefined,
                jobLocation: [],
                company: { companyName: "Acme", logo: {} },
            }),
        ]);

        expect(results.map((r) => r.file && r.file.filename)).toEqual([
            "acme-software-engineer.jpg",
            "long-title.jpg",
        ]);
    });
});

describe("logo fetch guard", () => {
    it("only fetches logos over HTTPS from the CDN every stored logo lives on", () => {
        expect(isAllowedLogoUrl(CDN_LOGO)).toBe(true);
        expect(isAllowedLogoUrl("http://res.cloudinary.com/demo/logo.png")).toBe(false);
        expect(isAllowedLogoUrl("https://169.254.169.254/latest/meta-data")).toBe(false);
        expect(isAllowedLogoUrl("https://res.cloudinary.com.evil.test/logo.png")).toBe(false);
        expect(isAllowedLogoUrl("not a url")).toBe(false);
    });

    it("never requests an off-CDN logo, and the banner still renders", async () => {
        const offCdn = job({ company: { companyName: "Acme", logo: { banner: "https://10.0.0.5/logo.png" } } });

        expect(await loadLogo(offCdn.company)).toBeNull();
        const [result] = await renderBanners([offCdn]);

        expect(axios.get).not.toHaveBeenCalled();
        expect(result.file).not.toBeNull();
    });
});

describe("detailLines — the admin banner's lines", () => {
    it("always prints degree and batch, then experience, salary and location when known", () => {
        expect(
            detailLines({
                experience: { min: 0, max: 0 },
                baseSalary: { currency: "INR", min: 600000, max: 1200000 },
                jobLocation: [{ city: "Pune" }, { region: "Karnataka" }],
            })
        ).toEqual([
            ["Degree", "B.Tech / B.E. / M.Tech / BCA / MCA"],
            ["Batch", "2024 / 2025 / 2026 / 2027"],
            ["Experience", "Fresher"],
            ["Salary", "₹6LPA - ₹12LPA"],
            ["Location", "Pune, Karnataka"],
        ]);

        expect(detailLines({ experience: { min: 1, max: 3 } }).map(([tag]) => tag)).toEqual([
            "Degree",
            "Batch",
            "Experience",
        ]);
    });
});
