/**
 * One-off repair for jobs whose applyLink points back at the board they were
 * scraped from.
 *
 * The transformer LLM picks applyLink, and until the sourceHost guard landed
 * nothing stopped it from answering with the aggregator's own permalink. The
 * result is a published job whose Apply button returns to FrontendGeek /
 * OffCampusJobs4u instead of reaching the employer.
 *
 * Three passes:
 *   1. Backfill `sourceHost` on existing StagingJob rows (from the adapter
 *      named in `source`), so the publish gate covers the pending backlog too.
 *   2. Repair live jobs where staging still holds a usable outbound URL on
 *      `companyPageUrl` — the link the scrape captured and the model discarded.
 *   3. Archive the rest. Nothing recoverable exists for them and a live listing
 *      that loops back to the aggregator is worse than no listing. This uses
 *      the reversible archive shape the cron sweeps use (`status: "archived"`,
 *      `deletedAt` left null), so they stay visible under the Archived tab and
 *      `POST /api/admin/jobs/v2/:id/restore` brings them back.
 *
 * Usage:
 *   node ./migration/scripts/fix-source-applylinks.js            # dry run
 *   node ./migration/scripts/fix-source-applylinks.js --apply    # write
 */

const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });

const mongoose = require("mongoose");

const root = path.join(__dirname, "..", "..", "src");
const JobV2 = require(path.join(root, "modules", "jobsV2", "jobsV2.model"));
const StagingJob = require(path.join(root, "modules", "scraper", "models", "stagingJob.model"));
const { listAllAdapters } = require(path.join(root, "modules", "scraper", "scraper.fetch"));
const { hostOf, pointsAtSourceSite } = require(path.join(root, "modules", "scraper", "sourceHost"));

const APPLY = process.argv.includes("--apply");

const COLORS = { reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", bold: "\x1b[1m" };
const color = (text, c) => `${COLORS[c] || ""}${text}${COLORS.reset}`;

// `companyPageUrl` is whatever outbound anchor the adapter's selector matched,
// and on the weaker boards that is sometimes the site's own social or chat
// link rather than an apply URL — Freshershunt's row offers a Telegram channel.
// Off-host is not enough to make a link an apply link, so these are treated as
// "nothing recoverable" and the job is archived instead of repointed.
const NOT_AN_APPLY_HOST = [
    "telegram.me", "t.me", "whatsapp.com", "chat.whatsapp.com",
    "facebook.com", "twitter.com", "x.com", "instagram.com",
    "youtube.com", "youtu.be", "linktr.ee",
];

function isApplyShaped(url) {
    const host = hostOf(url);
    if (!host) return false;
    return !NOT_AN_APPLY_HOST.some((h) => host === h || host.endsWith(`.${h}`));
}

// Same detection the transformer uses: platform follows the applyLink host.
function detectApplyPlatform(applyLink) {
    if (!applyLink || typeof applyLink !== "string") return "careerspage";
    if (applyLink.startsWith("mailto:")) return "email";
    const host = hostOf(applyLink);
    if (!host) return "careerspage";
    if (host.includes("linkedin.com")) return "linkedin";
    if (host.includes("cuvette.tech")) return "cuvette";
    return "careerspage";
}

async function main() {
    await mongoose.connect(process.env.DATABASE);
    console.log(color(APPLY ? "\nMODE: APPLY (writing)\n" : "\nMODE: DRY RUN (no writes)\n", "bold"));

    const adapters = listAllAdapters();
    const hostByAdapter = new Map(adapters.map((a) => [a.name, hostOf(a.baseUrl)]));
    const hosts = [...new Set([...hostByAdapter.values()].filter(Boolean))];
    console.log(`Aggregator hosts: ${hosts.join(", ")}\n`);

    // ── Pass 1: backfill sourceHost on staging ────────────────────────────
    let stamped = 0;
    for (const [name, host] of hostByAdapter) {
        if (!host) continue;
        const filter = { source: name, $or: [{ sourceHost: { $exists: false } }, { sourceHost: null }, { sourceHost: "" }] };
        const n = await StagingJob.countDocuments(filter);
        if (!n) continue;
        stamped += n;
        console.log(`  staging ${name}: stamp sourceHost=${host} on ${n} rows`);
        if (APPLY) await StagingJob.updateMany(filter, { $set: { sourceHost: host } });
    }
    console.log(color(`Pass 1: ${stamped} staging rows ${APPLY ? "stamped" : "would be stamped"}\n`, "cyan"));

    // ── Passes 2 & 3: live jobs whose applyLink loops back ────────────────
    const hostRe = new RegExp(hosts.map((h) => h.replace(/\./g, "\\.")).join("|"), "i");
    const jobs = await JobV2.find({ applyLink: hostRe, deletedAt: null }).sort({ createdAt: -1 });

    const repaired = [];
    const archived = [];

    for (const job of jobs) {
        // The regex is a coarse prefilter; confirm the host really is one.
        const sourceHost = hosts.find((h) => pointsAtSourceSite(job.applyLink, h));
        if (!sourceHost) continue;

        const staging =
            (await StagingJob.findOne({ approvedJob: job._id })) ||
            (await StagingJob.findOne({ "jobData.applyLink": job.applyLink }));

        const replacement = staging && staging.companyPageUrl;
        const usable =
            typeof replacement === "string" &&
            replacement.trim() &&
            !pointsAtSourceSite(replacement, sourceHost) &&
            isApplyShaped(replacement);

        if (usable) {
            repaired.push({ job, sourceHost, from: job.applyLink, to: replacement.trim() });
        } else {
            const reason = !staging
                ? "no staging row"
                : !replacement
                    ? "staging has no companyPageUrl"
                    : !isApplyShaped(replacement)
                        ? `staging URL is not an apply link (${hostOf(replacement)})`
                        : "staging URL is on the source site";
            archived.push({ job, sourceHost, reason });
        }
    }

    console.log(color(`Pass 2: repair ${repaired.length} live jobs from their staging companyPageUrl`, "green"));
    for (const r of repaired) {
        console.log(`  ${r.job.companyName} | ${r.job.title}`);
        console.log(`    ${color("-", "red")} ${r.from}`);
        console.log(`    ${color("+", "green")} ${r.to}`);
        if (APPLY) {
            r.job.applyLink = r.to;
            r.job.applyPlatform = detectApplyPlatform(r.to);
            await r.job.save();
        }
    }

    console.log(color(`\nPass 3: archive ${archived.length} live jobs with no recoverable apply link`, "yellow"));
    for (const a of archived) {
        console.log(`  [${a.reason}] ${a.job.companyName} | ${a.job.title}`);
        console.log(`    ${a.job.applyLink}`);
        if (APPLY) {
            a.job.status = "archived";
            await a.job.save();
        }
    }

    console.log(
        color(
            `\nSummary: ${stamped} staging stamped, ${repaired.length} repaired, ${archived.length} archived` +
            (APPLY ? "" : "  (dry run — rerun with --apply to write)"),
            "bold"
        )
    );

    await mongoose.disconnect();
}

main().catch(async (err) => {
    console.error(color(`\nFailed: ${err.message}`, "red"));
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
