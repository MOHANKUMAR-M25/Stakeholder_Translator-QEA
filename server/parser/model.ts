export interface ParsedFailure {
  suite: string;
  test: string;
  message: string;
  highImpact: boolean;
}

export interface ParsedSuite {
  name: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
}

export interface ParsedReport {
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  passRatePct: number;
  durationSec: number;
  suites: ParsedSuite[];
  failures: ParsedFailure[];
  rag: "green" | "amber" | "red";
  ragLabel: string;
}

export const NORMALIZED_REPORT_FORMAT = "stakeholder-translator.normalized.v1";

const CRITICAL_KEYWORDS = [
  "auth",
  "login",
  "payment",
  "checkout",
  "security",
  "encryption",
  "pii",
  "gdpr",
  "compliance",
  "transaction",
  "wire",
  "kyc",
  "fraud",
];

export function isHighImpact(text: string): boolean {
  const normalized = text.toLowerCase();
  return CRITICAL_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

export function asNonNegativeNumber(value: unknown, fallback = 0): number {
  if (typeof value === "string" && value.trim() === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function asNonNegativeInteger(value: unknown, fallback = 0): number {
  return Math.floor(asNonNegativeNumber(value, fallback));
}

export function boundedText(value: unknown, fallback: string, limit = 300): string {
  let text = "";

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    text = String(value);
  } else if (Array.isArray(value)) {
    text = value.map((entry) => boundedText(entry, "", limit)).filter(Boolean).join("; ");
  } else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    text = boundedText(
      record.message ?? record["#text"] ?? record.text ?? record.value,
      "",
      limit
    );
  }

  const normalized = text.replace(/\s+/g, " ").trim() || fallback;
  return normalized.slice(0, limit);
}

function normalizeSuite(suite: ParsedSuite): ParsedSuite {
  const passed = asNonNegativeInteger(suite.passed);
  const failed = asNonNegativeInteger(suite.failed);
  const skipped = asNonNegativeInteger(suite.skipped);
  const accountedFor = passed + failed + skipped;
  const total = Math.max(asNonNegativeInteger(suite.total), accountedFor);

  return {
    name: boundedText(suite.name, "Suite", 160),
    total,
    passed,
    failed,
    skipped,
  };
}

function computeRag(total: number, failed: number, failures: ParsedFailure[]) {
  const failRate = total > 0 ? (failed / total) * 100 : 0;
  const hasCritical = failures.some((failure) => failure.highImpact);
  if (hasCritical || failRate > 20) {
    return { rag: "red" as const, ragLabel: "High risk" };
  }
  if (failRate > 5) {
    return { rag: "amber" as const, ragLabel: "Moderate risk" };
  }
  return { rag: "green" as const, ragLabel: "Low risk" };
}

export function finalizeReport(
  inputSuites: ParsedSuite[],
  inputFailures: ParsedFailure[],
  durationSec: number
): ParsedReport {
  const suitesByName = new Map<string, ParsedSuite>();

  for (const rawSuite of inputSuites) {
    const suite = normalizeSuite(rawSuite);
    const existing = suitesByName.get(suite.name);
    if (existing) {
      existing.total += suite.total;
      existing.passed += suite.passed;
      existing.failed += suite.failed;
      existing.skipped += suite.skipped;
    } else {
      suitesByName.set(suite.name, { ...suite });
    }
  }

  const suites = [...suitesByName.values()];
  const failures = inputFailures.map((failure) => {
    const suite = boundedText(failure.suite, "Suite", 160);
    const test = boundedText(failure.test, "unnamed test", 200);
    const message = boundedText(failure.message, "Failed", 300);
    return {
      suite,
      test,
      message,
      highImpact:
        Boolean(failure.highImpact) || isHighImpact(`${suite} ${test} ${message}`),
    };
  });

  const totalTests = suites.reduce((sum, suite) => sum + suite.total, 0);
  const passed = suites.reduce((sum, suite) => sum + suite.passed, 0);
  const failed = suites.reduce((sum, suite) => sum + suite.failed, 0);
  const skipped = suites.reduce((sum, suite) => sum + suite.skipped, 0);
  const passRatePct =
    totalTests > 0 ? Math.round((passed / totalTests) * 1000) / 10 : 0;
  const rag = computeRag(totalTests, failed, failures);

  return {
    totalTests,
    passed,
    failed,
    skipped,
    passRatePct,
    durationSec: Math.round(asNonNegativeNumber(durationSec)),
    suites,
    failures,
    ...rag,
  };
}

export function toCanonicalReport(report: ParsedReport) {
  return {
    format: NORMALIZED_REPORT_FORMAT,
    ...report,
  };
}
