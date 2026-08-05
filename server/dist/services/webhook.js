import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
/** Deterministic fallback message — no LLM call needed, so this always works even if the model is down. */
export function buildFallbackAlert(report, trend) {
    const topFailure = report.failures.find((f) => f.highImpact) || report.failures[0];
    const lines = [
        `🔴 ${report.ragLabel} — ${report.failed}/${report.totalTests} tests failing (${report.passRatePct}% pass rate).`,
    ];
    if (trend?.hasPrevious && trend.newlyFailing.length > 0) {
        lines.push(`${trend.newlyFailing.length} test(s) newly broke since the last run.`);
    }
    if (topFailure) {
        lines.push(`Top issue: ${topFailure.suite} · ${topFailure.test} — ${topFailure.message}`);
    }
    lines.push("Open the Stakeholder Translator for the full breakdown.");
    return lines.join("\n");
}
/**
 * Fire-and-forget style notification to a Slack/Discord/Teams-compatible incoming webhook.
 * `webhookUrl` (per-request override) wins over the server-side WEBHOOK_URL env var.
 * Never throws — a broken webhook shouldn't fail a translate request.
 */
export async function notifyWebhook(text, webhookUrlOverride) {
    const url = webhookUrlOverride || env.webhookUrl;
    if (!url)
        return { attempted: false, ok: false };
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // `text` covers Slack-style webhooks, `content` covers Discord-style ones — harmless extra field either way.
            body: JSON.stringify({ text, content: text }),
        });
        const ok = res.ok;
        if (!ok)
            logger.warn("Webhook notification rejected", { status: res.status });
        return { attempted: true, ok, status: res.status };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn("Webhook notification failed", { message });
        return { attempted: true, ok: false, error: message };
    }
}
