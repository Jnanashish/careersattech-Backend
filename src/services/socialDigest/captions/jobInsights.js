// Ported from admin-panel/src/Helpers/JobListHelper/jobInsights.js — ESM → CommonJS,
// content otherwise verbatim. The admin Daily Digest builds the same caption
// in the browser, so a change to one copy must be made to the other.

const { hashtagBank } = require("./hashtagBank");

const NUMBER_EMOJI = [
    "1️⃣",
    "2️⃣",
    "3️⃣",
    "4️⃣",
    "5️⃣",
    "6️⃣",
    "7️⃣",
    "8️⃣",
    "9️⃣",
    "🔟",
];

const TIER1_SET = new Set([
    "google",
    "microsoft",
    "amazon",
    "meta",
    "apple",
    "netflix",
    "adobe",
    "salesforce",
    "oracle",
    "uber",
    "nvidia",
    "intel",
    "blackrock",
    "visa",
    "mastercard",
    "jpmorgan",
    "goldmansachs",
    "morganstanley",
]);

const ROLE_KEYWORDS = [
    {
        key: "fullstack",
        patterns: [/full[\s-]?stack/i, /\bmern\b/i, /\bmean\b/i],
    },
    {
        key: "frontend",
        patterns: [
            /front[\s-]?end/i,
            /\breact\b/i,
            /\bnext\.?js\b/i,
            /\bangular\b/i,
            /\bvue\b/i,
            /\bui (developer|engineer)\b/i,
            /\bweb (developer|engineer)\b/i,
        ],
    },
    {
        key: "backend",
        patterns: [
            /back[\s-]?end/i,
            /\bjava (developer|engineer)\b/i,
            /\bpython (developer|engineer)\b/i,
            /\bnode\.?js\b/i,
            /\bgo(lang)? (developer|engineer)\b/i,
            /\bspring\b/i,
            /\bapi (developer|engineer)\b/i,
        ],
    },
    {
        key: "data",
        patterns: [
            /\bdata (engineer|analyst|scientist)\b/i,
            /\banalytics\b/i,
            /\betl\b/i,
            /\bsql\b/i,
            /\bpower ?bi\b/i,
        ],
    },
    {
        key: "aiml",
        patterns: [
            /\bml engineer\b/i,
            /\bai engineer\b/i,
            /machine learning/i,
            /deep learning/i,
            /\bnlp\b/i,
            /\bgen[\s-]?ai\b/i,
        ],
    },
    {
        key: "devops",
        patterns: [
            /\bdevops\b/i,
            /\bsre\b/i,
            /site reliability/i,
            /\bcloud (engineer|developer)\b/i,
            /\bplatform engineer\b/i,
            /\bkubernetes\b/i,
        ],
    },
    {
        key: "mobile",
        patterns: [
            /\bandroid\b/i,
            /\bios\b/i,
            /\bflutter\b/i,
            /react native/i,
            /\bmobile (developer|engineer)\b/i,
        ],
    },
    {
        key: "qa",
        patterns: [
            /\bqa\b/i,
            /\bsdet\b/i,
            /\btest (engineer|automation)\b/i,
            /\bautomation (testing|engineer)\b/i,
            /\bselenium\b/i,
        ],
    },
    {
        key: "security",
        patterns: [
            /\bsecurity (engineer|analyst)\b/i,
            /\binfosec\b/i,
            /\bcyber ?security\b/i,
            /\bappsec\b/i,
        ],
    },
];

const TECH_KEYWORDS = [
    { tech: "React.js", pattern: /\breact( ?\.?js)?\b/i },
    { tech: "Next.js", pattern: /\bnext\.?js\b/i },
    { tech: "Angular", pattern: /\bangular\b/i },
    { tech: "Vue.js", pattern: /\bvue(\.?js)?\b/i },
    { tech: "TypeScript", pattern: /\btypescript\b/i },
    { tech: "Node.js", pattern: /\bnode\.?js\b/i },
    { tech: "Java", pattern: /\bjava\b(?! ?script)/i },
    { tech: "Python", pattern: /\bpython\b/i },
    { tech: "Go", pattern: /\bgo(lang)?\b/i },
    { tech: "Rust", pattern: /\brust\b/i },
    { tech: "Kotlin", pattern: /\bkotlin\b/i },
    { tech: "Swift", pattern: /\bswift\b/i },
    { tech: "Flutter", pattern: /\bflutter\b/i },
    { tech: "Android", pattern: /\bandroid\b/i },
    { tech: "iOS", pattern: /\bios\b/i },
    { tech: "JavaScript", pattern: /\bjavascript\b/i },
];

const ROLE_LABEL = {
    frontend: "Frontend",
    backend: "Backend",
    fullstack: "Fullstack",
    data: "Data",
    aiml: "AI/ML",
    devops: "DevOps",
    mobile: "Mobile",
    qa: "QA",
    security: "Security",
    generic: "Software",
};

const ROLE_DEFAULT_TECH = {
    frontend: "React.js",
    backend: "Java",
    fullstack: "Full-stack",
    data: "SQL",
    aiml: "Python",
    devops: "Cloud",
    mobile: "Mobile",
    qa: "Automation",
    security: "Security",
    generic: "Code",
};

const detectRole = (title = "") => {
    if (!title) return "generic";
    for (const { key, patterns } of ROLE_KEYWORDS) {
        if (patterns.some((p) => p.test(title))) return key;
    }
    return "generic";
};

const detectTech = (title = "", role = "generic") => {
    for (const { tech, pattern } of TECH_KEYWORDS) {
        if (pattern.test(title)) return tech;
    }
    return ROLE_DEFAULT_TECH[role] || ROLE_DEFAULT_TECH.generic;
};

const detectCity = (jobLocation = []) => {
    if (!Array.isArray(jobLocation) || !jobLocation.length) return null;
    const cityKeys = Object.keys(hashtagBank.location);
    for (const loc of jobLocation) {
        const city = (loc?.city || loc?.region || "").toLowerCase();
        if (!city) continue;
        for (const key of cityKeys) {
            if (city.includes(key)) return key;
            if (key === "bangalore" && city.includes("bengaluru")) return key;
            if (key === "gurgaon" && city.includes("gurugram")) return key;
        }
    }
    return null;
};

const companyKey = (name = "") => {
    const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "")
        .trim();
    if (!slug) return null;
    return Object.keys(hashtagBank.company).find(
        (k) => slug === k || slug.startsWith(k) || k.startsWith(slug)
    ) || null;
};

const formatCity = (city) =>
    city ? city.charAt(0).toUpperCase() + city.slice(1) : "";

const formatLocations = (jobLocation = []) => {
    if (!Array.isArray(jobLocation) || !jobLocation.length) return "Multiple";
    const cities = jobLocation
        .map((l) => l?.city || l?.region)
        .filter(Boolean)
        .map(formatCity);
    return cities.length ? Array.from(new Set(cities)).join(" / ") : "Multiple";
};

const buildJobLine = (job, idx) => {
    const prefix = NUMBER_EMOJI[idx] || `${idx + 1}.`;
    const company = job?.companyName || job?.company?.name || "Company";
    const title = job?.title || job?.role || "Engineer";
    const locs = formatLocations(job?.jobLocation);
    return `${prefix} ${company} — ${title} | ${locs}`;
};

const uniq = (arr) => Array.from(new Set(arr.filter(Boolean)));

const isInternshipJob = (job) => {
    const et = job?.employmentType;
    if (Array.isArray(et)) return et.some((v) => /INTERN/i.test(v));
    return /INTERN/i.test(et || "");
};

const deriveInsights = (jobs = []) => {
    const list = Array.isArray(jobs) ? jobs : [];
    const count = list.length;

    const titles = list.map((j) => j?.title || j?.role || "");
    const roles = titles.map(detectRole);
    const dominantRole =
        roles.find((r) => r !== "generic") || roles[0] || "generic";
    const role = dominantRole;
    const roleCap = ROLE_LABEL[role] || "Software";

    const tech = detectTech(titles[0] || "", role);

    const companyNames = uniq(
        list.map((j) => j?.companyName || j?.company?.name)
    );
    const companies = companyNames.join(", ");
    const companyKeys = uniq(companyNames.map(companyKey));

    const cityKeys = uniq(list.map((j) => detectCity(j?.jobLocation)));

    const batches = uniq(
        list.flatMap((j) => (Array.isArray(j?.batch) ? j.batch : []))
    ).join(", ");
    const degrees = uniq(
        list.flatMap((j) => (Array.isArray(j?.degree) ? j.degree : []))
    ).join(", ");

    const jobsList = list.map(buildJobLine).join("\n");

    const isInternship = list.length > 0 && list.every(isInternshipJob);
    const isSingleCompany = companyNames.length === 1 && count > 0;
    const isTier1 = companyKeys.some((k) => TIER1_SET.has(k));
    const isMixedRoles = uniq(roles).length > 1;

    return {
        count,
        role,
        roleCap,
        tech,
        companies,
        companyNames,
        companyKeys,
        cityKeys,
        batches,
        degrees,
        jobsList,
        isInternship,
        isSingleCompany,
        isTier1,
        isMixedRoles,
    };
};

const pickTemplate = (insights) => {
    if (!insights) return "alert";
    if (insights.isInternship) return "internship";
    if (insights.isSingleCompany && insights.count >= 2) return "spotlight";
    if (insights.isTier1) return "tier1";
    if (insights.isMixedRoles) return "curation";
    return "alert";
};

const pickCodeword = (insights) =>
    insights?.isInternship ? "INTERN" : "LINK";

module.exports = {
    detectRole,
    detectTech,
    detectCity,
    companyKey,
    deriveInsights,
    pickTemplate,
    pickCodeword,
};
