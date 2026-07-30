import type { TranslateRequest } from "../providers/types.js";
import { createProvider } from "../providers/factory.js";
import { runAgenticTurn } from "../agent/runtime.js";
import { listAvailableTools } from "../mcp/transport.js";
import { ingestReport, getReport } from "../parser/store.js";
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


function buildStandardPrompt(audience: TranslateRequest["audience"], reportId: string): string {
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

AUDIENCE: ${spec.label}
${spec.instructions}`;
}

/** Agentic mode: no report data stuffed into the prompt — the model must call tools to get it. */
function buildAgenticPrompt(audience: TranslateRequest["audience"], reportId: string): string {
  const spec = AUDIENCE_SPEC[audience];
  return `${SHARED_PREAMBLE}

A test report has been loaded with report id "${reportId}". Use the available tools
(getSummary, getRiskAnalysis, listFailedTests, getModule, getMetrics, search, etc. — all take
this reportId) to gather whatever you need. Do not guess at numbers; call the tools.

AUDIENCE: ${spec.label}
${spec.instructions}`;
}

export async function translate(req: TranslateRequest): Promise<{ text: string; source: string }> {
  logger.request({ provider: req.provider, execution: req.execution, auth: req.auth });

  const { reportId } = ingestReport(req.report);
  const provider = createProvider(req.provider, req.auth, req.apiKey);

  if (req.execution === "standard") {
    const prompt = buildStandardPrompt(req.audience, reportId);
    const response = await provider.run([{ role: "user", content: prompt }], []);
    return { text: response.content, source: `${req.provider}-${req.auth}-standard` };
  }

  // Agentic mode
  if (req.auth === "cli") {
    const prompt = buildAgenticPrompt(req.audience, reportId);
    const tools = await listAvailableTools();
    const response = await provider.run([{ role: "user", content: prompt }], tools);
    return { text: response.content, source: `${req.provider}-cli-agentic` };
  }

  // API + agentic: we run the real MCP tool-calling loop ourselves.
  const prompt = buildAgenticPrompt(req.audience, reportId);
  const text = await runAgenticTurn(provider, prompt);
  return { text, source: `${req.provider}-api-agentic` };
}
