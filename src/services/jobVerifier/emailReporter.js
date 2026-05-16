const logger = require("../../utils/logger");

let resendClient = null;
let resendWarned = false;

function getClient() {
    if (resendClient) return resendClient;
    if (!process.env.RESEND_API_KEY) {
        if (!resendWarned) {
            logger.warn("[verifyJobs:email] RESEND_API_KEY not set — email summary disabled");
            resendWarned = true;
        }
        return null;
    }
    try {
        const { Resend } = require("resend");
        resendClient = new Resend(process.env.RESEND_API_KEY);
        return resendClient;
    } catch (err) {
        if (!resendWarned) {
            logger.warn(
                `[verifyJobs:email] resend package not installed: ${err.message}. Run \`npm i resend\`.`
            );
            resendWarned = true;
        }
        return null;
    }
}

function escapeHtml(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatIst(date) {
    try {
        return new Intl.DateTimeFormat("en-IN", {
            timeZone: "Asia/Kolkata",
            dateStyle: "medium",
            timeStyle: "short",
        }).format(date);
    } catch (_) {
        return date.toISOString();
    }
}

function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    const s = sec % 60;
    return `${min}m ${s}s`;
}

function buildHtml(summary, options) {
    const dryRun = !!options.dryRun;
    const archivedRows = summary.archivedJobs
        .map(
            (j) => `
        <tr>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;font-family:monospace;font-size:12px;">${escapeHtml(j.slug)}</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;">${escapeHtml(j.companyName)}</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;">${escapeHtml(j.title)}</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;font-family:monospace;font-size:12px;">${escapeHtml(j.reason)}</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;font-family:monospace;font-size:11px;word-break:break-all;max-width:360px;">${escapeHtml(j.applyLink)}</td>
        </tr>`
        )
        .join("");

    const inconclusiveRows = summary.inconclusiveJobs
        .map(
            (j) => `
        <tr>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;font-family:monospace;font-size:12px;">${escapeHtml(j.slug)}</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;">${escapeHtml(j.companyName)}</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;">${escapeHtml(j.title)}</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;font-family:monospace;font-size:12px;">${escapeHtml(j.reason)}</td>
          <td style="padding:6px 10px;border:1px solid #e5e7eb;text-align:center;">${j.consecutiveInconclusive}</td>
        </tr>`
        )
        .join("");

    const banner = dryRun
        ? `<p style="background:#fef3c7;color:#92400e;padding:10px;border-radius:6px;font-family:sans-serif;"><b>DRY RUN</b> — no database writes were performed.</p>`
        : "";

    const heartbeat = summary.totalChecked === 0
        ? `<p style="font-family:sans-serif;color:#374151;">No active jobs to verify this run. The cron is alive.</p>`
        : "";

    return `<!doctype html>
<html><body style="font-family: -apple-system, system-ui, sans-serif; color:#111827; max-width: 900px;">
  ${banner}
  <h2 style="font-family:sans-serif;">Job verifier run — ${escapeHtml(formatIst(summary.completedAt))}</h2>
  <p style="font-family:sans-serif;"><strong>Duration:</strong> ${escapeHtml(formatDuration(summary.durationMs))}</p>

  ${heartbeat}

  <table style="border-collapse: collapse; font-family: sans-serif; margin: 12px 0;">
    <tr><td style="padding:6px 12px;border:1px solid #e5e7eb;">Total checked</td><td style="padding:6px 12px;border:1px solid #e5e7eb;"><b>${summary.totalChecked}</b></td></tr>
    <tr><td style="padding:6px 12px;border:1px solid #e5e7eb;">Active (no change)</td><td style="padding:6px 12px;border:1px solid #e5e7eb;">${summary.activeCount}</td></tr>
    <tr><td style="padding:6px 12px;border:1px solid #e5e7eb;">Expired (auto-archived)</td><td style="padding:6px 12px;border:1px solid #e5e7eb;color:#b94a48;"><b>${summary.expiredCount}</b></td></tr>
    <tr><td style="padding:6px 12px;border:1px solid #e5e7eb;">Inconclusive (skipped)</td><td style="padding:6px 12px;border:1px solid #e5e7eb;">${summary.inconclusiveCount}</td></tr>
  </table>

  <h3 style="font-family:sans-serif;">Auto-archived jobs (${summary.expiredCount})</h3>
  ${archivedRows ? `<table style="border-collapse: collapse; font-family: sans-serif;">
    <thead><tr style="background:#f9fafb;">
      <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:left;">Slug</th>
      <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:left;">Company</th>
      <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:left;">Title</th>
      <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:left;">Reason</th>
      <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:left;">URL</th>
    </tr></thead>
    <tbody>${archivedRows}</tbody>
  </table>` : `<p style="font-family:sans-serif;color:#6b7280;">None.</p>`}

  <h3 style="font-family:sans-serif;">Inconclusive jobs (${summary.inconclusiveCount}) — manual review suggested if a job appears here 3+ times in a row</h3>
  ${inconclusiveRows ? `<table style="border-collapse: collapse; font-family: sans-serif;">
    <thead><tr style="background:#f9fafb;">
      <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:left;">Slug</th>
      <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:left;">Company</th>
      <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:left;">Title</th>
      <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:left;">Reason</th>
      <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:left;">Consecutive</th>
    </tr></thead>
    <tbody>${inconclusiveRows}</tbody>
  </table>` : `<p style="font-family:sans-serif;color:#6b7280;">None.</p>`}

  <p style="font-size:12px;color:#888;font-family:sans-serif;margin-top:24px;">Sent automatically by the CareersAt.Tech backend.</p>
</body></html>`;
}

function buildText(summary, options) {
    const dryRun = !!options.dryRun;
    const lines = [];
    if (dryRun) lines.push("[DRY RUN] No database writes were performed.", "");
    lines.push(`Job verifier run — ${formatIst(summary.completedAt)}`);
    lines.push(`Duration: ${formatDuration(summary.durationMs)}`);
    lines.push("");
    if (summary.totalChecked === 0) {
        lines.push("No active jobs to verify this run. The cron is alive.");
        lines.push("");
    }
    lines.push(`Total checked:           ${summary.totalChecked}`);
    lines.push(`Active (no change):      ${summary.activeCount}`);
    lines.push(`Expired (auto-archived): ${summary.expiredCount}`);
    lines.push(`Inconclusive (skipped):  ${summary.inconclusiveCount}`);
    lines.push("");
    lines.push(`Auto-archived jobs (${summary.expiredCount}):`);
    if (!summary.archivedJobs.length) lines.push("  - none");
    for (const j of summary.archivedJobs) {
        lines.push(`  - [${j.slug}] ${j.companyName} — ${j.title}`);
        lines.push(`      reason: ${j.reason}`);
        lines.push(`      url:    ${j.applyLink}`);
    }
    lines.push("");
    lines.push(`Inconclusive jobs (${summary.inconclusiveCount}):`);
    if (!summary.inconclusiveJobs.length) lines.push("  - none");
    for (const j of summary.inconclusiveJobs) {
        lines.push(
            `  - [${j.slug}] ${j.companyName} — ${j.title} (${j.reason}, consecutive=${j.consecutiveInconclusive})`
        );
    }
    lines.push("");
    lines.push("Sent automatically by the CareersAt.Tech backend.");
    return lines.join("\n");
}

function buildSubject(summary, options) {
    const prefix = options.dryRun ? "[DRY RUN] " : "";
    return `${prefix}[CareersAt.Tech] Job verifier run — ${summary.expiredCount} archived, ${summary.inconclusiveCount} inconclusive`;
}

/**
 * Send the summary email. No-op (with a warning) if Resend is not configured.
 *
 * @param {object} summary
 * @param {object} [options]
 * @param {boolean} [options.dryRun]
 * @returns {Promise<{ sent: boolean, reason?: string, id?: string }>}
 */
async function sendSummary(summary, options = {}) {
    const to = process.env.VERIFY_EMAIL_TO;
    const from = process.env.VERIFY_EMAIL_FROM || "onboarding@resend.dev";

    if (!to) {
        logger.warn("[verifyJobs:email] VERIFY_EMAIL_TO not set — skipping summary email");
        return { sent: false, reason: "no-recipient" };
    }

    const client = getClient();
    if (!client) return { sent: false, reason: "no-client" };

    const subject = buildSubject(summary, options);
    const html = buildHtml(summary, options);
    const text = buildText(summary, options);

    try {
        const { data, error } = await client.emails.send({
            from,
            to: [to],
            subject,
            html,
            text,
        });
        if (error) {
            logger.error(`[verifyJobs:email] Resend error: ${error.message || JSON.stringify(error)}`);
            return { sent: false, reason: "resend-error" };
        }
        logger.info(`[verifyJobs:email] summary sent to ${to} (id=${data?.id || "?"})`);
        return { sent: true, id: data?.id };
    } catch (err) {
        logger.error(`[verifyJobs:email] send failed: ${err.message}`);
        return { sent: false, reason: "exception" };
    }
}

module.exports = {
    sendSummary,
    _internals: { buildSubject, buildHtml, buildText, formatIst, formatDuration },
};
