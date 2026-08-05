import type { ParsedFailure, ParsedReport, ParsedSuite } from "./junit.js";
import { parseJUnitXML } from "./junit.js";

const CRITICAL_KEYWORDS = [
  "auth", "login", "payment", "checkout", "security", "encryption",
  "pii", "gdpr", "compliance", "transaction", "wire", "kyc", "fraud",
];

function isHighImpact(text: string): boolean {
  const t = text.toLowerCase();
  return CRITICAL_KEYWORDS.some((kw) => t.includes(kw));
}

function computeRag(total: number, failed: number, failures: ParsedFailure[]) {
  const failRate = total > 0 ? (failed / total) * 100 : 0;
  const hasCritical = failures.some((f) => f.highImpact);
  if (hasCritical || failRate > 20) return { rag: "red" as const, ragLabel: "High risk" };
  if (failRate > 5) return { rag: "amber" as const, ragLabel: "Moderate risk" };
  return { rag: "green" as const, ragLabel: "Low risk" };
}

function finalize(suites: ParsedSuite[], failures: ParsedFailure[], durationSec: number): ParsedReport {
  const totalTests = suites.reduce((a, s) => a + s.total, 0);
  const passed = suites.reduce((a, s) => a + s.passed, 0);
  const failed = suites.reduce((a, s) => a + s.failed, 0);
  const skipped = suites.reduce((a, s) => a + s.skipped, 0);
  const passRatePct = totalTests > 0 ? Math.round((passed / totalTests) * 1000) / 10 : 0;
  const { rag, ragLabel } = computeRag(totalTests, failed, failures);
  return { totalTests, passed, failed, skipped, passRatePct, durationSec, suites, failures, rag, ragLabel };
}

export function parseJSONReport(text: string): ParsedReport {
  const data = JSON.parse(text);
  const rawSuites = data.suites || data.testsuites || (Array.isArray(data) ? data : null);
  if (!rawSuites) throw new Error("Expected a JSON report with a `suites` array.");

  const suites: ParsedSuite[] = [];
  const failures: ParsedFailure[] = [];
  let durationSec = 0;

  for (const s of rawSuites) {
    const name = s.name || "Suite";
    durationSec += Number(s.duration || s.time || 0);

    let passed = 0, failed = 0, skipped = 0;
    const results = s.results || s.testcases || [];
    for (const r of results) {
      const status = (r.status || r.result || "").toLowerCase();
      if (status.includes("pass")) passed++;
      else if (status.includes("fail") || status.includes("error")) {
        failed++;
        const message = r.message || r.error || "Failed";
        failures.push({
          suite: name,
          test: r.name || "unnamed test",
          message,
          highImpact: isHighImpact(`${name} ${r.name || ""} ${message}`),
        });
      } else if (status.includes("skip")) skipped++;
    }

    const total = s.tests || passed + failed + skipped;
    suites.push({ name, total, passed, failed, skipped });
  }

  return finalize(suites, failures, Math.round(durationSec));
}

export function parseLogReport(text: string): ParsedReport {
  const surefire = text.match(/Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)/i);
  const pytest = text.match(/(\d+)\s+passed(?:,\s*(\d+)\s+failed)?(?:,\s*(\d+)\s+skipped)?/i);

  let total: number, failed: number, skipped: number, passed: number;
  if (surefire) {
    const [, t, f, e, s] = surefire.map(Number);
    total = t; failed = f + e; skipped = s; passed = total - failed - skipped;
  } else if (pytest) {
    passed = Number(pytest[1] || 0); failed = Number(pytest[2] || 0); skipped = Number(pytest[3] || 0);
    total = passed + failed + skipped;
  } else {
    throw new Error("Couldn't recognize a pass/fail summary in this text.");
  }

  const failNames = [...text.matchAll(/FAILED\s+([\w./:\-]+)/g)].map((m) => m[1].trim());
  const failures: ParsedFailure[] = failNames.map((n) => ({
    suite: "CI run",
    test: n,
    message: "See CI log for details",
    highImpact: isHighImpact(n),
  }));

  return finalize([{ name: "CI run", total, passed, failed, skipped }], failures, 0);
}

export function parseAnyReport(rawText: string): ParsedReport {
  const text = rawText.trim();
  if (text.startsWith("<")) return parseJUnitXML(text);
  if (text.startsWith("{") || text.startsWith("[")) return parseJSONReport(text);
  return parseLogReport(text);
}
