// Ported from admin-panel/src/Helpers/JobListHelper/captionTemplates.js — ESM → CommonJS,
// content otherwise verbatim. The admin panel builds the same caption in the
// browser, so a change to one copy must be made to the other.

// =========================================================
// @careersattech — Instagram caption formats
// Six formats, rotated by weekday (IST). The city-wise and batch-wise
// formats only apply when the jobs span 2+ cities / 2+ batch ranges.
//
// The backend's Telegram digest builds the same caption
// (services/socialDigest/captions/captionTemplates.js) — keep the two in sync.
// =========================================================

const { hashtagBank } = require("./hashtagBank");
const { companyKey, detectCity } = require("./jobInsights");

const NUMBER_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
const DIVIDER = "━━━━━━━━━━━━━━━";

// Stored city spellings vary; captions use one name per city.
const CITY_ALIASES = { bengaluru: "Bangalore", gurugram: "Gurgaon" };

const uniq = (arr) => Array.from(new Set(arr.filter(Boolean)));

const titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

const cityName = (raw = "") => {
    const s = raw.trim();
    return CITY_ALIASES[s.toLowerCase()] || titleCase(s);
};

const jobCities = (job) => {
    const cities = uniq(
        (Array.isArray(job?.jobLocation) ? job.jobLocation : []).map((l) =>
            cityName(l?.city || l?.region || "")
        )
    );
    if (!cities.length && job?.workMode === "remote") return ["Remote"];
    return cities;
};

const jobBatches = (job) =>
    uniq((Array.isArray(job?.batch) ? job.batch : []).map(Number))
        .filter(Number.isFinite)
        .sort((a, b) => a - b);

// [2024, 2025, 2026] → "2024–2026" (full) or "2024–26" (short).
const batchSpan = (batches, short = false) => {
    if (!batches.length) return "";
    const lo = batches[0];
    const hi = batches[batches.length - 1];
    if (lo === hi) return String(lo);
    return `${lo}–${short ? String(hi).slice(-2) : hi}`;
};

// ["A", "B", "C"] → "A, B & C"
const joinAnd = (items) =>
    items.length <= 1
        ? items.join("")
        : `${items.slice(0, -1).join(", ")} & ${items[items.length - 1]}`;

const company = (job) => job?.companyName || job?.company?.companyName || "Company";
const title = (job) => job?.title || job?.role || "Software Engineer";
const headline = (job) => `${company(job)} — ${title(job)}`;

const allCities = (jobs) => uniq(jobs.flatMap(jobCities));
const allBatches = (jobs) => uniq(jobs.flatMap(jobBatches)).sort((a, b) => a - b);
const allCompanies = (jobs) => uniq(jobs.map(company));
const spans = (jobs) => uniq(jobs.map((j) => batchSpan(jobBatches(j))));

const companyTag = (job) => (hashtagBank.company[companyKey(company(job))] || [])[0];
const cityTag = (city) => {
    const key = detectCity([{ city }]) || (city === "Remote" ? "remote" : null);
    return key ? hashtagBank.location[key][0] : null;
};

// ─── Formats ────────────────────────────────────────────────────────────
// Each returns { body, hashtags }. Hashtags are capped to 5 by the builder.

const listFormat = (jobs) => {
    const cities = allCities(jobs);
    const span = batchSpan(allBatches(jobs));
    const names = allCompanies(jobs);
    const companiesText =
        names.length > 3 ? `${names.slice(0, 3).join(", ")} & more` : joinAnd(names);
    const n = jobs.length;
    const top = [
        "Software engineer jobs for freshers",
        span && `${span} batch`,
        cities.length && cities.join(", "),
    ].filter(Boolean);

    const lines = jobs.map((j, i) =>
        [
            `${NUMBER_EMOJI[i] || `${i + 1}.`} ${headline(j)}`,
            jobCities(j).join(" / "),
            batchSpan(jobBatches(j), true),
        ]
            .filter(Boolean)
            .join(" | ")
    );

    return {
        body: [
            top.join(" | "),
            `${n} off-campus ${n === 1 ? "opening" : "openings"} at ${companiesText} 👇`,
            [DIVIDER, ...lines, DIVIDER].join("\n"),
            [
                `💬 Comment "JOBS" and we'll DM you the apply links`,
                "📌 Save this so you don't lose it",
                "👥 Tag a friend who's job hunting",
            ].join("\n"),
        ].join("\n\n"),
        hashtags: [
            "#softwareengineerjobs",
            "#offcampusdrive",
            "#fresherjobsindia",
            "#techjobsindia",
            companyTag(jobs[0]),
        ],
    };
};

const alertFormat = (jobs) => {
    const cities = allCities(jobs);
    const span = batchSpan(allBatches(jobs));
    const meta = [
        cities.length && cities.join(" | "),
        span && `Batch ${span} (check each slide for eligibility)`,
    ].filter(Boolean);

    return {
        body: [
            `New fresher SDE openings 🔔 ${allCompanies(jobs).join(", ")}`,
            meta.join("\n"),
            [
                `💬 Comment "JOBS" for the links`,
                "🔔 Turn on post notifications so you catch the next drop early",
            ].join("\n"),
        ]
            .filter(Boolean)
            .join("\n\n"),
        hashtags: [
            "#newjobalert",
            "#sdejobs",
            "#freshersjobs",
            "#softwaredeveloperjobs",
            "#techcareers",
        ],
    };
};

const spotlightFormat = (jobs) => {
    const [lead, ...rest] = jobs;
    const cities = jobCities(lead);
    const batches = jobBatches(lead);
    const degrees = uniq(Array.isArray(lead?.degree) ? lead.degree : []);
    const codeword = (company(lead).split(/\s+/)[0] || "JOBS")
        .replace(/[^a-z0-9]/gi, "")
        .toUpperCase();

    const hook = `${company(lead)} is hiring ${title(lead)} freshers${
        cities.length ? ` in ${joinAnd(cities)}` : ""
    } 🚀`;
    const eligibility = [
        batches.length && `${joinAnd(batches.map(String))} batch`,
        degrees.length ? `${degrees.join(", ")} eligible` : "Any graduate eligible",
    ]
        .filter(Boolean)
        .join(" | ");

    const others = uniq(rest.map(company));
    const swipe = rest.length
        ? `Swipe for ${rest.length} more off-campus ${rest.length === 1 ? "role" : "roles"} 👉\n${others.join(" • ")}`
        : "";

    return {
        body: [
            `${hook}\n${eligibility}`,
            swipe,
            [`💬 Comment "${codeword || "JOBS"}" for the apply link`, "📌 Save for later"].join("\n"),
        ]
            .filter(Boolean)
            .join("\n\n"),
        hashtags: [
            companyTag(lead),
            "#sdejobs",
            "#offcampusdrive",
            "#fresherjobsindia",
            "#softwareengineerjobs",
        ],
    };
};

const cityFormat = (jobs) => {
    const OTHER = "Other locations";
    const groups = new Map();
    for (const j of jobs) {
        const cities = jobCities(j);
        for (const c of cities.length ? cities : [OTHER]) {
            if (!groups.has(c)) groups.set(c, []);
            groups.get(c).push(j);
        }
    }
    const rank = (c) => (c === OTHER ? 2 : c === "Remote" ? 1 : 0);
    const order = [...groups.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    const named = order.filter((c) => c !== OTHER && c !== "Remote");

    return {
        body: [
            `Software engineer jobs for freshers in ${joinAnd(named.length ? named : order)} 📍`,
            ...order.map((c) =>
                [`🏙️ ${c}`, ...groups.get(c).map((j) => `- ${headline(j)}`)].join("\n")
            ),
            [`👥 Tag a friend in your city`, `💬 Comment "JOBS" for the apply links`].join("\n"),
        ].join("\n\n"),
        hashtags: [...order.map(cityTag), "#techjobsindia"],
    };
};

const batchFormat = (jobs) => {
    const groups = new Map();
    for (const j of jobs) {
        const key = batchSpan(jobBatches(j)) || "Any";
        if (!groups.has(key)) groups.set(key, { batches: jobBatches(j), jobs: [] });
        groups.get(key).jobs.push(j);
    }
    // Newest batches first.
    const last = (b) => b[b.length - 1] || 0;
    const order = [...groups.entries()].sort(
        ([, a], [, b]) => last(b.batches) - last(a.batches) || (b.batches[0] || 0) - (a.batches[0] || 0)
    );
    const newest = allBatches(jobs).slice(-2).reverse();

    return {
        body: [
            "Fresher software engineer jobs sorted by batch 🎓",
            ...order.map(([key, g]) =>
                [
                    `📅 ${key === "Any" ? "Any" : key} batch`,
                    ...g.jobs.map((j) =>
                        [`→ ${headline(j)}`, jobCities(j).join(" / ")].filter(Boolean).join(" | ")
                    ),
                ].join("\n")
            ),
            [`📌 Save this and find your batch`, `💬 Comment "JOBS" to get apply links in DM`].join("\n"),
        ].join("\n\n"),
        hashtags: [
            ...newest.map((b) => `#batch${b}`),
            newest[0] && `#fresherjobs${newest[0]}`,
            "#softwareengineerjobs",
            "#itjobsindia",
        ],
    };
};

const questionFormat = (jobs) => {
    // Headline the two newest batch years; older-only roles get their batch
    // spelled out and move to the end.
    const target = allBatches(jobs).slice(-2);
    const fits = (j) => jobBatches(j).some((b) => target.includes(b));

    const ordered = [...jobs.filter(fits), ...jobs.filter((j) => !fits(j))];
    const lines = ordered.map((j) => {
        const where = jobCities(j).join(" / ");
        const extra = fits(j) || !jobBatches(j).length ? "" : ` (${batchSpan(jobBatches(j), true)} batch)`;
        return `🔹 ${headline(j)}${where ? ` | ${where}` : ""}${extra}`;
    });

    const companies = allCompanies(jobs).length;
    const lead =
        companies === jobs.length
            ? `These ${companies} ${companies === 1 ? "company is" : "companies are"} hiring freshers off-campus right now:`
            : `These ${jobs.length} off-campus roles are open for freshers right now:`;
    const hook = target.length
        ? `Graduating in ${target.join(" or ")} and still looking for a software engineer job? 👀`
        : "Still looking for a software engineer job? 👀";

    return {
        body: [
            hook,
            lead,
            lines.join("\n"),
            [`Which one are you applying to? Tell us below 👇`, `💬 Comment "JOBS" for the apply links`].join("\n"),
        ].join("\n\n"),
        hashtags: [
            target.length ? `#${target[target.length - 1]}batch` : null,
            "#softwareengineerjobs",
            "#offcampushiring",
            "#jobsforfreshers",
            "#techjobsindia",
        ],
    };
};

// ─── Registry + rotation ────────────────────────────────────────────────

const CAPTION_FORMATS = {
    list: { label: "Numbered list", build: listFormat },
    alert: { label: "New openings alert", build: alertFormat },
    spotlight: { label: "Company spotlight", build: spotlightFormat },
    city: {
        label: "City-wise",
        build: cityFormat,
        isEligible: (jobs) => allCities(jobs).length >= 2,
        needs: "jobs in 2+ cities",
    },
    batch: {
        label: "Batch-wise",
        build: batchFormat,
        isEligible: (jobs) => spans(jobs).length >= 2,
        needs: "jobs with 2+ batch ranges",
    },
    question: { label: "Question hook", build: questionFormat },
};

const FORMAT_OPTIONS = Object.entries(CAPTION_FORMATS).map(([key, f]) => ({
    key,
    label: f.label,
    needs: f.needs || null,
}));

const isFormatEligible = (key, jobs = []) => {
    const f = CAPTION_FORMATS[key];
    return !!f && (!f.isEligible || f.isEligible(jobs));
};

// Sunday → Saturday. Sunday repeats the list since there are six formats.
const WEEKDAY_ROTATION = ["list", "list", "alert", "spotlight", "city", "batch", "question"];

const istWeekday = (date) => {
    const name = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Kolkata",
        weekday: "short",
    }).format(date);
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
};

// Today's format. City-wise / batch-wise fall back to the numbered list when
// the jobs don't span enough cities or batches.
const pickFormat = (jobs = [], now = new Date()) => {
    const key = WEEKDAY_ROTATION[istWeekday(now)] || "list";
    return isFormatEligible(key, jobs) ? key : "list";
};

module.exports = {
    CAPTION_FORMATS,
    FORMAT_OPTIONS,
    isFormatEligible,
    pickFormat,
};
