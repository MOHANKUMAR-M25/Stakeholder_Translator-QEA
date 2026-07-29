import { XMLParser } from "fast-xml-parser";

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

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

export function parseJUnitXML(xml: string): ParsedReport {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text" });
  const doc = parser.parse(xml);

  const root = doc.testsuites ?? doc;
  const suiteNodes = asArray<any>(root.testsuite);
  if (suiteNodes.length === 0) {
    throw new Error("No <testsuite> elements found — expected JUnit/TestNG XML.");
  }

  const suites: ParsedSuite[] = [];
  const failures: ParsedFailure[] = [];
  let durationSec = 0;

  for (const s of suiteNodes) {
    const name = s["@_name"] || "Suite";
    const total = parseInt(s["@_tests"] || "0", 10);
    const failCount = parseInt(s["@_failures"] || "0", 10) + parseInt(s["@_errors"] || "0", 10);
    const skip = parseInt(s["@_skipped"] || "0", 10);
    const time = parseFloat(s["@_time"] || "0");
    durationSec += isNaN(time) ? 0 : time;

    const passed = Math.max(total - failCount - skip, 0);
    suites.push({ name, total, passed, failed: failCount, skipped: skip });

    for (const tc of asArray<any>(s.testcase)) {
      const failNode = tc.failure ?? tc.error;
      if (!failNode) continue;
      const testName = tc["@_name"] || "unnamed test";
      const message =
        (typeof failNode === "object" ? failNode["@_message"] || failNode["#text"] : String(failNode)) || "Failed";
      failures.push({
        suite: name,
        test: testName,
        message: String(message).slice(0, 300),
        highImpact: isHighImpact(`${name} ${testName} ${message}`),
      });
    }
  }

  const totalTests = suites.reduce((a, s) => a + s.total, 0);
  const passed = suites.reduce((a, s) => a + s.passed, 0);
  const failed = suites.reduce((a, s) => a + s.failed, 0);
  const skipped = suites.reduce((a, s) => a + s.skipped, 0);
  const passRatePct = totalTests > 0 ? Math.round((passed / totalTests) * 1000) / 10 : 0;
  const { rag, ragLabel } = computeRag(totalTests, failed, failures);

  return {
    totalTests,
    passed,
    failed,
    skipped,
    passRatePct,
    durationSec: Math.round(durationSec),
    suites,
    failures,
    rag,
    ragLabel,
  };
}
