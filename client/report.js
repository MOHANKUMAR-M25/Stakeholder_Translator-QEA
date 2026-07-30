// Parses a raw test report (JUnit-style XML, a suites-shaped JSON report, or a
// plain-text CI log) into the normalized shape the UI renders directly.
//
// Normalized shape:
// {
//   totalTests, passed, failed, skipped, passRatePct, durationSec,
//   suites: [{ name, total, passed, failed, skipped }],
//   failures: [{ suite, test, message, highImpact }],
//   rag: "green" | "amber" | "red",
//   ragLabel: string,
// }

const CRITICAL_KEYWORDS = [
  "auth", "login", "payment", "checkout", "security", "encryption",
  "pii", "gdpr", "compliance", "transaction", "wire", "kyc", "fraud",
];

function isHighImpact(text) {
  const t = (text || "").toLowerCase();
  return CRITICAL_KEYWORDS.some((kw) => t.includes(kw));
}

function computeRag(total, failed, failures) {
  const failRate = total > 0 ? (failed / total) * 100 : 0;
  const hasCritical = failures.some((f) => f.highImpact);
  if (hasCritical || failRate > 20) return { rag: "red", ragLabel: "High risk" };
  if (failRate > 5) return { rag: "amber", ragLabel: "Moderate risk" };
  return { rag: "green", ragLabel: "Low risk" };
}

function finalize(suites, failures, durationSec) {
  const totalTests = suites.reduce((s, x) => s + x.total, 0);
  const passed = suites.reduce((s, x) => s + x.passed, 0);
  const failed = suites.reduce((s, x) => s + x.failed, 0);
  const skipped = suites.reduce((s, x) => s + x.skipped, 0);
  const passRatePct = totalTests > 0 ? Math.round((passed / totalTests) * 1000) / 10 : 0;
  const { rag, ragLabel } = computeRag(totalTests, failed, failures);
  return { totalTests, passed, failed, skipped, passRatePct, durationSec, suites, failures, rag, ragLabel };
}

function parseXML(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Malformed XML.");

  const suiteEls = [...doc.querySelectorAll("testsuite")];
  if (suiteEls.length === 0) throw new Error("No <testsuite> elements found — expected JUnit/TestNG XML.");

  const suites = [];
  const failures = [];
  let durationSec = 0;

  for (const el of suiteEls) {
    const name = el.getAttribute("name") || "Suite";
    const tests = parseInt(el.getAttribute("tests") || "0", 10);
    const failCount = parseInt(el.getAttribute("failures") || "0", 10) + parseInt(el.getAttribute("errors") || "0", 10);
    const skip = parseInt(el.getAttribute("skipped") || "0", 10);
    const time = parseFloat(el.getAttribute("time") || "0");
    durationSec += isNaN(time) ? 0 : time;

    const passCount = Math.max(tests - failCount - skip, 0);
    suites.push({ name, total: tests, passed: passCount, failed: failCount, skipped: skip });

    for (const tc of el.querySelectorAll("testcase")) {
      const failEl = tc.querySelector("failure, error");
      if (!failEl) continue;
      const testName = tc.getAttribute("name") || "unnamed test";
      const message = failEl.getAttribute("message") || failEl.textContent?.trim().slice(0, 160) || "Failed";
      failures.push({
        suite: name,
        test: testName,
        message,
        highImpact: isHighImpact(`${name} ${testName} ${message}`),
      });
    }
  }

  return finalize(suites, failures, Math.round(durationSec));
}

function parseJSONReport(text) {
  const data = JSON.parse(text);
  const rawSuites = data.suites || data.testsuites || (Array.isArray(data) ? data : null);
  if (!rawSuites) throw new Error("Expected a JSON report with a `suites` array.");

  const suites = [];
  const failures = [];
  let durationSec = 0;

  for (const s of rawSuites) {
    const name = s.name || "Suite";
    const tests = s.tests || (s.results ? s.results.length : 0);
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

    const total = tests || passed + failed + skipped;
    suites.push({ name, total, passed, failed, skipped });
  }

  return finalize(suites, failures, Math.round(durationSec));
}

function parseLog(text) {
  const surefire = text.match(/Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)/i);
  const pytest = text.match(/(\d+)\s+passed(?:,\s*(\d+)\s+failed)?(?:,\s*(\d+)\s+skipped)?/i);

  let total, failed, skipped, passed;
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
  const failures = failNames.map((n) => ({
    suite: "CI run",
    test: n,
    message: "See CI log for details",
    highImpact: isHighImpact(n),
  }));

  return finalize([{ name: "CI run", total, passed, failed, skipped }], failures, 0);
}

export function parseReport(rawText) {
  const text = rawText.trim();
  if (text.startsWith("<")) return parseXML(text);
  if (text.startsWith("{") || text.startsWith("[")) return parseJSONReport(text);
  return parseLog(text);
}

export const SAMPLE_JUNIT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="AuthService" tests="14" failures="2" errors="0" skipped="1" time="18.4">
    <testcase name="test_login_success" time="0.4"/>
    <testcase name="test_login_invalid_password" time="0.3">
      <failure message="AssertionError: expected 401, got 500">at auth.spec.js:42</failure>
    </testcase>
    <testcase name="test_session_refresh" time="0.6"/>
    <testcase name="test_payment_checkout_flow" time="1.2">
      <failure message="TimeoutError: checkout confirmation not received within 5000ms">at checkout.spec.js:88</failure>
    </testcase>
  </testsuite>
  <testsuite name="SearchService" tests="22" failures="0" errors="0" skipped="0" time="9.1">
    <testcase name="test_search_by_keyword" time="0.2"/>
    <testcase name="test_search_pagination" time="0.3"/>
  </testsuite>
</testsuites>`;
