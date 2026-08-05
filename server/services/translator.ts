import type { TranslateRequest, AgentTraceEntry } from "../providers/types.js";
import { createProvider } from "../providers/factory.js";
import { runAgenticTurn } from "../agent/runtime.js";
import { listAvailableTools } from "../mcp/transport.js";
import { ingestReport, getReport, computeTrend, type TrendResult } from "../parser/store.js";
import { notifyWebhook, buildFallbackAlert } from "./webhook.js";
import { logger } from "../utils/logger.js";

const AUDIENCE_SPEC: Record<TranslateRequest["audience"], { label: string; instructions: string }> = {
  dm: {
    label: "Delivery Manager",
    instructions:
      "Write a 3-line, SMS-style update. Tight, operational, no fluff. What ran, what broke, " +
      "what needs a decision from them today. No preamble, no sign-off — just the 3 lines.",
  },
  po: {
    label: "Product Owner",
    instructions:
      "Write a 1-page narrative for someone who owns the roadmap, not the test suite. Cover: " +
      "what this means for the release, user-facing risk, the tradeoff/decision they need to " +
      "make, and a clear recommendation. Prose, not bullet points.",
  },
  client: {
    label: "Client Slide",
    instructions:
      "Write a risk-flagged slide outline for an external client. Start with a RAG flag on its " +
      "own line in brackets, e.g. [AMBER]. Then 4-6 bullet points max, confident and non-alarming " +
      "but honest about risk. End with one clear recommendation or next step.",
  },
};

const SHARED_PREAMBLE =
  "You are the Stakeholder Translator, an AI agent built for QA leads. You take raw, technical " +
  "test-execution data and convert it into a boardroom-ready story. You never dump raw numbers on " +
  "a reader — every output is a framed narrative grounded in real data, with business-impact " +
  "context and a clear recommendation. Output only the narrative itself — no headers, no markdown " +
  "fencing, no meta-commentary.";


function formatTrendForPrompt(trend: TrendResult): string {
  if (!trend.hasPrevious) return "  (no previous run recorded yet — this is the first one)";
  const lines = [`  - ${trend.summary}`];
  if (trend.newlyFailing.length) lines.push(`  - Newly failing since last run: ${trend.newlyFailing.join(", ")}`);
  if (trend.newlyFixed.length) lines.push(`  - Newly fixed since last run: ${trend.newlyFixed.join(", ")}`);
  return lines.join("\n");
}

function buildStandardPrompt(audience: TranslateRequest["audience"], reportId: string, trend: TrendResult): string {
  const spec = AUDIENCE_SPEC[audience];
  const report = getReport(reportId);

  const suiteLines = report.suites
    .map((s: any) => `  - ${s.name}: ${s.passed}/${s.total} passed, ${s.failed} failed, ${s.skipped} skipped`)
    .join("\n");
  const failureLines = report.failures
    .slice(0, 20)
    .map((f: any) => `  - [${f.highImpact ? "HIGH IMPACT" : "low impact"}] ${f.suite} · ${f.test}: ${f.message}`)
    .join("\n");

  return `${SHARED_PREAMBLE}

STRUCTURED REPORT (ground truth):
- Total tests: ${report.totalTests}
- Passed: ${report.passed}
- Failed: ${report.failed}
- Skipped: ${report.skipped}
- Pass rate: ${report.passRatePct}%
- Duration: ${report.durationSec}s
- Computed risk: ${report.ragLabel} (${report.rag})

Suites:
${suiteLines || "  (none)"}

Failures:
${failureLines || "  (none)"}

Trend vs. previous run (use this to say whether things are getting better or worse — don't
speculate about trend beyond what's given here):
${formatTrendForPrompt(trend)}

AUDIENCE: ${spec.label}
${spec.instructions}`;
}

/** Agentic mode: no report data stuffed into the prompt — the model must call tools to get it. */
function buildAgenticPrompt(audience: TranslateRequest["audience"], reportId: string): string {
  const spec = AUDIENCE_SPEC[audience];
  return `${SHARED_PREAMBLE}

A test report has been loaded with report id "${reportId}". Use the available tools
(getSummary, getRiskAnalysis, listFailedTests, getModule, getMetrics, getTrend, search, etc. — all
take this reportId) to gather whatever you need. Do not guess at numbers; call the tools. Call
getTrend if the audience would care whether things are improving or regressing versus the last run.

AUDIENCE: ${spec.label}
${spec.instructions}`;
}

export interface TranslateResult {
  text: string;
  source: string;
  trend: TrendResult;
  trace?: AgentTraceEntry[];
  webhook: { attempted: boolean; ok: boolean; status?: number; error?: string };
}

export async function translate(req: TranslateRequest): Promise<TranslateResult> {
  logger.request({ provider: req.provider, execution: req.execution, auth: req.auth });

  const { reportId, report } = await ingestReport({
    text: req.report,
    base64: req.reportBase64,
    filename: req.reportFilename,
    format: req.reportFormat,
  });
  const trend = computeTrend(reportId, report);
  const provider = createProvider(req.provider, req.auth, req.apiKey);

  let text: string;
  let source: string;
  let trace: AgentTraceEntry[] | undefined;

  if (req.execution === "standard") {
    const prompt = buildStandardPrompt(req.audience, reportId, trend);
    const response = await provider.run([{ role: "user", content: prompt }], []);
    text = response.content;
    source = `${req.provider}-${req.auth}-standard`;
  } else if (req.auth === "cli") {
    // Agentic + CLI: the CLI runs its own tool-calling loop, so we don't get a trace back.
    const prompt = buildAgenticPrompt(req.audience, reportId);
    const tools = await listAvailableTools();
    const response = await provider.run([{ role: "user", content: prompt }], tools);
    text = response.content;
    source = `${req.provider}-cli-agentic`;
  } else {
    // Agentic + API: we run the real MCP tool-calling loop ourselves, so we can capture every step.
    const prompt = buildAgenticPrompt(req.audience, reportId);
    const result = await runAgenticTurn(provider, prompt);
    text = result.text;
    trace = result.trace;
    source = `${req.provider}-api-agentic`;
  }

  // Auto-notify on red-RAG runs. Best-effort — never lets a webhook failure fail the translate call.
  let webhook: TranslateResult["webhook"] = { attempted: false, ok: false };
  if (report.rag === "red") {
    const alertText = req.audience === "dm" ? text : buildFallbackAlert(report, trend);
    webhook = await notifyWebhook(alertText, req.webhookUrl);
  }

  return { text, source, trend, trace, webhook };
}
