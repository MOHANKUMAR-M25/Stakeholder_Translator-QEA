import type { ParsedFailure, ParsedReport, ParsedSuite } from "./junit.js";

const CRITICAL_KEYWORDS = [
  "auth", "login", "payment", "checkout", "security", "encryption",
  "pii", "gdpr", "compliance", "transaction", "wire", "kyc", "fraud",
];

export function isHighImpact(text: string): boolean {
  const t = text.toLowerCase();
  return CRITICAL_KEYWORDS.some((kw) => t.includes(kw));
}

export function computeRag(total: number, failed: number, failures: ParsedFailure[]) {
  const failRate = total > 0 ? (failed / total) * 100 : 0;
  const hasCritical = failures.some((f) => f.highImpact);
  if (hasCritical || failRate > 20) return { rag: "red" as const, ragLabel: "High risk" };
  if (failRate > 5) return { rag: "amber" as const, ragLabel: "Moderate risk" };
  return { rag: "green" as const, ragLabel: "Low risk" };
}

export function finalizeReport(suites: ParsedSuite[], failures: ParsedFailure[], durationSec: number): ParsedReport {
  const totalTests = suites.reduce((a, s) => a + s.total, 0);
  const passed = suites.reduce((a, s) => a + s.passed, 0);
  const failed = suites.reduce((a, s) => a + s.failed, 0);
  const skipped = suites.reduce((a, s) => a + s.skipped, 0);
  const passRatePct = totalTests > 0 ? Math.round((passed / totalTests) * 1000) / 10 : 0;
  const { rag, ragLabel } = computeRag(totalTests, failed, failures);
  return { totalTests, passed, failed, skipped, passRatePct, durationSec: Math.round(durationSec), suites, failures, rag, ragLabel };
}

/** Formats this repo's parsers can accept, keyed by lowercase file extension (no dot). */
export const SUPPORTED_FORMATS = ["xml", "json", "csv", "html", "htm", "txt", "log", "xlsx", "xls", "pdf"] as const;
export type SupportedFormat = (typeof SUPPORTED_FORMATS)[number];

/** Binary formats can't be sniffed from text content — the client must send them as base64 with a format/filename. */
export const BINARY_FORMATS = new Set(["xlsx", "xls", "pdf"]);
