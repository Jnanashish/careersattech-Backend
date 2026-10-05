const fs = require("fs");
const path = require("path");
const axios = require("axios");
const sharp = require("sharp");
const satori = require("satori").default;
const { Resvg } = require("@resvg/resvg-js");
const logger = require("../../../utils/logger");

// Server-side copy of the admin panel's CareersAtTech banner
// (admin-panel/src/Components/Canvas/CareersAtTechBanner.jsx with
// canvas.module.scss), in the layout the Daily Digest page draws for the
// "Join instagram channel for apply link 👇" CTA. Same fonts and the same
// sizes, drawn with satori → resvg → sharp instead of html-to-image in a
// browser, so the 16:00 cron can make banners unattended. A change to the
// banner design has to be made in both places.

const ASSETS = path.join(__dirname, "assets");

const WIDTH = 1080;
const HEIGHT = 1350;
// The admin captures at pixelRatio 2; matching it gives the same 2160×2700
// file the Daily Digest page downloads.
const SCALE = 2;
const GRID = 30; // $gridBoxSize

const BLUE = "#0050ff";
const LOGO_TEXT_BLUE = "#0069ff";
const DETAILS_BG = "#f0f8ff";
const FOOTER_BG = "#121212";
const LIME = "#D6FF3D";

const NEUE = "Helvetica Neue";
const NOW_TEXT = "Helvetica Now Text";

// Printed on every banner whatever the job says — CareersAtTechBanner's
// HARDCODED_DEGREE / HARDCODED_BATCH.
const DEGREE_LINE = "B.Tech / B.E. / M.Tech / BCA / MCA";
const BATCH_LINE = "2024 / 2025 / 2026 / 2027";

// Daily Digest CTA option 4. It is the one that drops the CTA into its own
// strip below the footer and shortens the details box to make room.
const CTA_LINE = "Join instagram channel for apply link 👇";

const UPPER_PADDING_X = 66;
const CONTENT_WIDTH = WIDTH - 2 - 2 * UPPER_PADDING_X; // inside the 1px borders
const LOGO_BOX_HEIGHT = 9 * GRID;
const LOGO_BOX_PADDING_TOP = 64;
// CANVAS_CSS.imgsize on the Daily Digest page: 60% of the logo box's content.
const LOGO_HEIGHT = 0.6 * (LOGO_BOX_HEIGHT - LOGO_BOX_PADDING_TOP);

// The faces the browser actually resolves the banner's CSS to (App.css
// @font-face): Helvetica Neue 600 falls through to Bold, and Helvetica Now
// Text only ships Bold files, so every weight of it renders Bold.
const FONT_FILES = [
    [NEUE, "HelveticaNeueRoman.otf", 400, "normal"],
    [NEUE, "HelveticaNeueItalic.ttf", 400, "italic"],
    [NEUE, "HelveticaNeueMedium.otf", 500, "normal"],
    [NEUE, "HelveticaNeueBold.otf", 700, "normal"],
    [NOW_TEXT, "helveticanowtext-bold-demo.ttf", 700, "normal"],
    [NOW_TEXT, "helveticanowtext-bolditalic-demo.ttf", 700, "italic"],
];

let assets = null;

function loadAssets() {
    if (assets) return assets;
    const read = (...parts) => fs.readFileSync(path.join(ASSETS, ...parts));
    const dataUrl = (buf, type) => `data:${type};base64,${buf.toString("base64")}`;
    assets = {
        fonts: FONT_FILES.map(([name, file, weight, style]) => ({
            name,
            data: read("fonts", file),
            weight,
            style,
        })),
        icons: ["instagram", "telegram", "linkedin"].map((name) =>
            dataUrl(read("icons", `${name}.png`), "image/png")
        ),
        // Twemoji 1f447, © Twitter / jdecked, CC-BY 4.0. The browser draws the
        // CTA's 👇 with the OS emoji font; there is none on the server.
        pointDown: dataUrl(read("1f447.svg"), "image/svg+xml"),
    };
    return assets;
}

// ─── Logo ────────────────────────────────────────────────────────────────

// Every stored logo lives on this CDN. Company documents can come from the
// scraper, so the logo URL is untrusted input to a server-side fetch: anything
// off this host — or a redirect away from it — is refused rather than fetched,
// and the banner falls back to the company name.
const LOGO_HOST = "res.cloudinary.com";
const LOGO_TIMEOUT_MS = 8000;
const LOGO_MAX_BYTES = 5 * 1024 * 1024;
// Twice the drawn height, so the logo stays sharp in the 2x render.
const LOGO_PIXEL_HEIGHT = Math.ceil(LOGO_HEIGHT * SCALE);

function isAllowedLogoUrl(url) {
    try {
        const u = new URL(url);
        return u.protocol === "https:" && u.hostname === LOGO_HOST;
    } catch {
        return false;
    }
}

/**
 * The company's logo as a PNG data URL with its size, or null when it has none
 * or the fetch fails — the banner then prints the company name, as the admin
 * banner does. Never throws.
 */
async function loadLogo(company) {
    const url = company?.logo?.banner || company?.logo?.icon;
    if (!url) return null;
    if (!isAllowedLogoUrl(url)) {
        logger.warn(`[digest] logo is not on ${LOGO_HOST}, banner uses the company name: ${url}`);
        return null;
    }
    try {
        const res = await axios.get(url, {
            responseType: "arraybuffer",
            timeout: LOGO_TIMEOUT_MS,
            maxContentLength: LOGO_MAX_BYTES,
            maxRedirects: 0,
        });
        // The CDN serves png, jpg, svg, webp and avif; normalise them all to
        // PNG, which is what the SVG renderer embeds reliably. Density makes an
        // SVG logo rasterise large enough before the resize.
        const { data, info } = await sharp(Buffer.from(res.data), { density: 300 })
            .resize({ height: LOGO_PIXEL_HEIGHT, withoutEnlargement: true })
            .png()
            .toBuffer({ resolveWithObject: true });
        return {
            src: `data:image/png;base64,${data.toString("base64")}`,
            width: info.width,
            height: info.height,
        };
    } catch (err) {
        logger.warn(`[digest] logo fetch failed, banner uses the company name: ${url} — ${err.message}`);
        return null;
    }
}

// ─── Detail strings ──────────────────────────────────────────────────────
// Ported from admin-panel/src/Helpers/JobListHelper/jobCanvasAdapter.js, so a
// detail line reads exactly as on the admin banner.

const formatExperience = (exp) => {
    if (!exp) return "";
    const min = exp.min ?? "";
    const max = exp.max ?? "";
    if (min === "" && max === "") return "";
    if (Number(min) === 0 && (max === "" || Number(max) === 0)) return "Fresher";
    if (min !== "" && max !== "") return `${min}-${max} years`;
    return `${min || max} years`;
};

const formatAmount = (n) => {
    const num = Number(n);
    if (!Number.isFinite(num) || num === 0) return "";
    const trim = (v) => (v % 1 === 0 ? v.toString() : v.toFixed(1).replace(/\.0$/, ""));
    if (num >= 100000) return `${trim(num / 100000)}LPA`;
    if (num >= 1000) return `${trim(num / 1000)}k`;
    return num.toString();
};

const formatSalary = (s) => {
    if (!s) return "";
    const min = s.min ?? "";
    const max = s.max ?? "";
    if (min === "" && max === "") return "";
    const cur = (s.currency || "").toUpperCase();
    const symbol =
        cur === "INR" ? "₹" : cur === "USD" ? "$" : cur === "EUR" ? "€" : s.currency ? `${s.currency} ` : "";
    const fmt = (v) => (v !== "" ? `${symbol}${formatAmount(v)}` : "");
    const minStr = fmt(min);
    const maxStr = fmt(max);
    if (minStr && maxStr) return `${minStr} - ${maxStr}`;
    return minStr || maxStr;
};

const formatLocation = (jobLocation = []) =>
    (Array.isArray(jobLocation) ? jobLocation : [])
        .map((l) => l?.city || l?.region || l?.country)
        .filter(Boolean)
        .join(", ");

/** The [tag, value] lines of the details box, in the admin banner's order. */
function detailLines(job) {
    const lines = [
        ["Degree", DEGREE_LINE],
        ["Batch", BATCH_LINE],
    ];
    const experience = formatExperience(job.experience);
    const salary = formatSalary(job.baseSalary);
    const location = formatLocation(job.jobLocation);
    if (experience && experience !== "N") lines.push(["Experience", experience]);
    if (salary && salary !== "N") lines.push(["Salary", salary]);
    if (location && location !== "N") lines.push(["Location", location]);
    return lines;
}

// ─── Layout ──────────────────────────────────────────────────────────────

const el = (type, style, children) => ({ type, props: { style, children } });

const img = (src, width, height, style = {}) => ({
    type: "img",
    props: { src, width, height, style: { width, height, ...style } },
});

// Browser-style inline text. satori lays children out as flex items, so a
// sentence with differently styled parts is split into words that wrap one at
// a time, the way the banner's inline HTML text does.
function inlineText(runs, style) {
    const words = [];
    for (const run of runs) {
        for (const word of String(run.text).split(/\s+/).filter(Boolean)) {
            words.push(el("span", { ...run.style, whiteSpace: "pre" }, `${word} `));
        }
    }
    return el("div", { display: "flex", flexWrap: "wrap", width: "100%", ...style }, words);
}

function header() {
    return el(
        "div",
        { display: "flex", height: GRID, alignItems: "flex-start", fontFamily: NOW_TEXT },
        [
            el("div", { display: "flex", fontSize: 28, fontWeight: 700, color: "#000" }, [
                el("span", {}, "Visit :"),
                el("span", { whiteSpace: "pre", fontStyle: "italic", color: BLUE }, " careersat.tech"),
            ]),
        ]
    );
}

function logoBlock(job, logo) {
    let content;
    if (logo) {
        let height = LOGO_HEIGHT;
        let width = (logo.width / logo.height) * height;
        // A very wide logo is scaled down whole rather than squeezed.
        if (width > CONTENT_WIDTH) {
            height *= CONTENT_WIDTH / width;
            width = CONTENT_WIDTH;
        }
        content = img(logo.src, width, height);
    } else {
        // The admin banner's text-logo fallback, sized down so a long name
        // stays on one line instead of running into the title.
        const name = job.companyName || "";
        const fontSize = Math.min(120, Math.floor(CONTENT_WIDTH / Math.max(1, name.length * 0.6)));
        content = el("div", { fontSize, fontWeight: 700, color: LOGO_TEXT_BLUE, lineHeight: 1.2 }, name);
    }
    return el(
        "div",
        { display: "flex", alignItems: "center", height: LOGO_BOX_HEIGHT, paddingTop: LOGO_BOX_PADDING_TOP },
        [content]
    );
}

function titleBlock(job) {
    return el("div", { display: "flex", alignItems: "center", height: 12 * GRID, paddingBottom: 60 }, [
        inlineText(
            [
                { text: "is hiring", style: { fontStyle: "italic", fontWeight: 400 } },
                { text: (job.title || "").trim(), style: { fontStyle: "normal", fontWeight: 500 } },
            ],
            { fontSize: 96, lineHeight: "120px", color: "#000" }
        ),
    ]);
}

function detailsBox(job) {
    return el(
        "div",
        {
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            height: 16 * GRID,
            paddingLeft: 120,
            backgroundColor: DETAILS_BG,
            borderTopLeftRadius: 50,
            borderTopRightRadius: 50,
        },
        detailLines(job).map(([tag, value]) =>
            inlineText(
                [
                    { text: tag, style: { fontWeight: 700 } },
                    { text: ":", style: {} },
                    { text: value, style: {} },
                ],
                { fontSize: 38, lineHeight: "70px", margin: "4.5px 0", color: "#000", fontWeight: 500 }
            )
        )
    );
}

function footer(icons) {
    return el(
        "div",
        {
            display: "flex",
            alignItems: "center",
            height: 2 * GRID,
            paddingLeft: 120,
            paddingRight: 60,
            backgroundColor: FOOTER_BG,
            fontFamily: NOW_TEXT,
            fontSize: 28,
        },
        [
            ...icons.map((src) => img(src, 24, 24, { marginRight: 5 })),
            el("div", { display: "flex", marginLeft: 10, color: "#fff", fontWeight: 700 }, [
                el("span", { whiteSpace: "pre" }, "Follow "),
                el("span", { whiteSpace: "pre", fontStyle: "italic", color: LIME }, "@careersattech"),
                el("span", { whiteSpace: "pre" }, " to get regular Job updates."),
            ]),
        ]
    );
}

function ctaStrip() {
    return el(
        "div",
        { display: "flex", alignItems: "center", flexGrow: 1, paddingLeft: 120, backgroundColor: DETAILS_BG },
        [
            inlineText([{ text: CTA_LINE, style: { fontWeight: 700, color: BLUE } }], {
                fontSize: 37,
                lineHeight: "70px",
                margin: "4.5px 0",
            }),
        ]
    );
}

function bannerElement(job, logo, icons) {
    return el(
        "div",
        {
            display: "flex",
            flexDirection: "column",
            width: WIDTH,
            height: HEIGHT,
            backgroundColor: "#fff",
            fontFamily: NEUE,
            // .canvas has a 1px black border, but the CTA strip overflows its
            // bottom edge, so the captured image shows only the top and sides.
            borderTop: "1px solid #000",
            borderLeft: "1px solid #000",
            borderRight: "1px solid #000",
        },
        [
            el(
                "div",
                {
                    display: "flex",
                    flexDirection: "column",
                    height: 24 * GRID,
                    padding: `55px ${UPPER_PADDING_X}px 0`,
                },
                [header(), logoBlock(job, logo), titleBlock(job)]
            ),
            el("div", { display: "flex", flexDirection: "column", flexGrow: 1 }, [
                detailsBox(job),
                footer(icons),
                ctaStrip(),
            ]),
        ]
    );
}

// ─── Render ──────────────────────────────────────────────────────────────

/**
 * One banner as a 2160×2700 JPEG buffer.
 *
 * @param {object} job lean JobV2 with `company` populated
 * @param {{src: string, width: number, height: number}|null} logo from loadLogo
 */
async function renderBanner(job, logo) {
    const { fonts, icons, pointDown } = loadAssets();
    const svg = await satori(bannerElement(job, logo, icons), {
        width: WIDTH,
        height: HEIGHT,
        fonts,
        // Only the CTA's emoji ships with the backend; any other emoji in a
        // title is left out rather than drawn as a missing-glyph box.
        loadAdditionalAsset: async (code, segment) => (code === "emoji" && segment === "👇" ? pointDown : ""),
    });
    const png = new Resvg(svg, {
        fitTo: { mode: "width", value: WIDTH * SCALE },
        font: { loadSystemFonts: false },
    })
        .render()
        .asPng();
    return sharp(png).jpeg({ quality: 95 }).toBuffer();
}

/**
 * One banner file per job, in order. A job whose banner fails to render comes
 * back with `file: null` and the error, so one bad title never sinks the rest.
 *
 * @returns {Promise<Array<{ job: object, file: {filename, buffer, contentType}|null, error?: Error }>>}
 */
async function renderBanners(jobs) {
    // Logos download in parallel; renders run one at a time, since each
    // 2160×2700 pass holds a few tens of MB.
    const logos = await Promise.all(jobs.map((job) => loadLogo(job.company)));
    const results = [];
    for (const [i, job] of jobs.entries()) {
        try {
            const buffer = await renderBanner(job, logos[i]);
            results.push({
                job,
                file: { filename: `${job.slug}.jpg`, buffer, contentType: "image/jpeg" },
            });
        } catch (err) {
            logger.error(`[digest] banner render failed for ${job.slug}: ${err.stack || err.message}`);
            results.push({ job, file: null, error: err });
        }
    }
    return results;
}

module.exports = {
    renderBanners,
    renderBanner,
    loadLogo,
    _internals: { detailLines, isAllowedLogoUrl, WIDTH, HEIGHT, SCALE, LOGO_HOST },
};
