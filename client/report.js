// Browser-side parsing for pasted XML, JSON, and text reports. Binary and
// tabular file uploads are normalized by the backend first, then represented
// with the same canonical JSON shape handled here.

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

function isHighImpact(text) {
  const normalized = String(text || "").toLowerCase();
  return CRITICAL_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function nonNegativeNumber(value, fallback = 0) {
  if (typeof value === "string" && !value.trim()) return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function nonNegativeInteger(value, fallback = 0) {
  return Math.floor(nonNegativeNumber(value, fallback));
}

function boundedText(value, fallback, limit = 300) {
  let text = "";
  if (["string", "number", "boolean"].includes(typeof value)) {
    text = String(value);
  } else if (Array.isArray(value)) {
    text = value.map((entry) => boundedText(entry, "", limit)).filter(Boolean).join("; ");
  } else if (value && typeof value === "object") {
    text = boundedText(
      value.message ?? value["#text"] ?? value.text ?? value.value,
      "",
      limit
    );
  }
  return (text.replace(/\s+/g, " ").trim() || fallback).slice(0, limit);
}

function computeRag(total, failed, failures) {
  const failRate = total > 0 ? (failed / total) * 100 : 0;
  const hasCritical = failures.some((failure) => failure.highImpact);
  if (hasCritical || failRate > 20) return { rag: "red", ragLabel: "High risk" };
  if (failRate > 5) return { rag: "amber", ragLabel: "Moderate risk" };
  return { rag: "green", ragLabel: "Low risk" };
}

function finalize(inputSuites, inputFailures, durationSec) {
  const suitesByName = new Map();
  for (const rawSuite of inputSuites) {
    const passed = nonNegativeInteger(rawSuite.passed);
    const failed = nonNegativeInteger(rawSuite.failed);
    const skipped = nonNegativeInteger(rawSuite.skipped);
    const suite = {
      name: boundedText(rawSuite.name, "Suite", 160),
      total: Math.max(nonNegativeInteger(rawSuite.total), passed + failed + skipped),
      passed,
      failed,
      skipped,
    };
    const existing = suitesByName.get(suite.name);
    if (existing) {
      existing.total += suite.total;
      existing.passed += suite.passed;
      existing.failed += suite.failed;
      existing.skipped += suite.skipped;
    } else {
      suitesByName.set(suite.name, suite);
    }
  }

  const suites = [...suitesByName.values()];
  const failures = inputFailures.map((rawFailure) => {
    const suite = boundedText(rawFailure.suite, "Suite", 160);
    const test = boundedText(rawFailure.test, "unnamed test", 200);
    const message = boundedText(rawFailure.message, "Failed", 300);
    return {
      suite,
      test,
      message,
      highImpact:
        Boolean(rawFailure.highImpact) || isHighImpact(`${suite} ${test} ${message}`),
    };
  });
  const totalTests = suites.reduce((sum, suite) => sum + suite.total, 0);
  const passed = suites.reduce((sum, suite) => sum + suite.passed, 0);
  const failed = suites.reduce((sum, suite) => sum + suite.failed, 0);
  const skipped = suites.reduce((sum, suite) => sum + suite.skipped, 0);
  const passRatePct =
    totalTests > 0 ? Math.round((passed / totalTests) * 1000) / 10 : 0;
  const { rag, ragLabel } = computeRag(totalTests, failed, failures);
  return {
    totalTests,
    passed,
    failed,
    skipped,
    passRatePct,
    durationSec: Math.round(nonNegativeNumber(durationSec)),
    suites,
    failures,
    rag,
    ragLabel,
  };
}

function directChildren(element, localName) {
  return [...element.children].filter(
    (child) => child.localName.toLowerCase() === localName
  );
}

function parseTestNg(doc) {
  if (!doc.querySelector("testng-results")) return null;
  const suites = new Map();
  const failures = [];
  let durationSec = 0;

  for (const method of doc.querySelectorAll("test-method")) {
    if ((method.getAttribute("is-config") || "").toLowerCase() === "true") continue;
    const statusText = (method.getAttribute("status") || "").toLowerCase();
    if (!statusText) continue;
    const suiteElement = method.closest("suite");
    const suiteName = suiteElement?.getAttribute("name") || "TestNG";
    const testName = method.getAttribute("name") || "unnamed test";
    const suite =
      suites.get(suiteName) ||
      { name: suiteName, total: 0, passed: 0, failed: 0, skipped: 0 };
    suite.total += 1;

    if (statusText.includes("pass")) {
      suite.passed += 1;
    } else if (statusText.includes("fail")) {
      suite.failed += 1;
      const exception = method.querySelector("exception");
      const message =
        exception?.querySelector("message")?.textContent ||
        exception?.querySelector("full-stacktrace")?.textContent ||
        "Failed";
      failures.push({
        suite: suiteName,
        test: testName,
        message,
        highImpact: isHighImpact(`${suiteName} ${testName} ${message}`),
      });
    } else {
      suite.skipped += 1;
    }

    durationSec +=
      nonNegativeNumber(method.getAttribute("duration-ms")) / 1000 ||
      nonNegativeNumber(method.getAttribute("time"));
    suites.set(suiteName, suite);
  }

  if (suites.size === 0) {
    throw new Error("No TestNG <test-method> results were found.");
  }
  return finalize([...suites.values()], failures, durationSec);
}

function parseXML(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) {
    throw new Error("XML document types and entities are not supported.");
  }
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Malformed XML.");

  const testNg = parseTestNg(doc);
  if (testNg) return testNg;

  const allSuiteElements = [...doc.getElementsByTagName("*")].filter(
    (element) => element.localName.toLowerCase() === "testsuite"
  );
  const suiteElements = allSuiteElements.filter(
    (element) =>
      directChildren(element, "testsuite").length === 0 ||
      directChildren(element, "testcase").length > 0
  );
  if (suiteElements.length === 0) {
    throw new Error("No JUnit <testsuite> or TestNG results were found.");
  }

  const suites = [];
  const failures = [];
  let durationSec = 0;

  for (const element of suiteElements) {
    const name = element.getAttribute("name") || "Suite";
    const testCases = directChildren(element, "testcase");
    let observedPassed = 0;
    let observedFailed = 0;
    let observedSkipped = 0;
    let observedDuration = 0;

    for (const testCase of testCases) {
      const failureElement = directChildren(testCase, "failure")[0] ||
        directChildren(testCase, "error")[0];
      const skippedElement = directChildren(testCase, "skipped")[0];
      const testName = testCase.getAttribute("name") || "unnamed test";
      observedDuration += nonNegativeNumber(testCase.getAttribute("time"));

      if (failureElement) {
        observedFailed += 1;
        const message =
          failureElement.getAttribute("message") ||
          failureElement.textContent?.trim() ||
          "Failed";
        failures.push({
          suite: name,
          test: testName,
          message,
          highImpact: isHighImpact(`${name} ${testName} ${message}`),
        });
      } else if (skippedElement) {
        observedSkipped += 1;
      } else {
        observedPassed += 1;
      }
    }

    const failed = Math.max(
      nonNegativeInteger(element.getAttribute("failures")) +
        nonNegativeInteger(element.getAttribute("errors")),
      observedFailed
    );
    const skipped = Math.max(
      nonNegativeInteger(element.getAttribute("skipped")),
      observedSkipped
    );
    const total = Math.max(
      nonNegativeInteger(element.getAttribute("tests")),
      testCases.length,
      observedPassed + failed + skipped
    );
    const passed = Math.max(total - failed - skipped, observedPassed, 0);
    const declaredDuration = nonNegativeNumber(element.getAttribute("time"));
    durationSec += declaredDuration || observedDuration;
    suites.push({ name, total, passed, failed, skipped });
  }

  return finalize(suites, failures, durationSec);
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function firstDefined(record, keys) {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function normalizeStatus(value) {
  if (typeof value === "boolean") return value ? "passed" : "failed";
  const status = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (!status) return null;
  if (/^(skip(?:ped)?|pending|ignored?|disabled|not run|not executed|blocked|todo|xfailed)$/.test(status)) {
    return "skipped";
  }
  if (/^(fail(?:ed|ure)?|error|errored|broken|ko|not passed|unsuccessful|xpassed|unexpected|timed out|timedout|interrupted)$/.test(status)) {
    return "failed";
  }
  if (/^(pass(?:ed|ing)?|success(?:ful)?|ok|green|complete(?:d)?|succeeded|expected|flaky)$/.test(status)) {
    return "passed";
  }
  if (status.includes("skip") || status.includes("pending")) return "skipped";
  if (status.includes("fail") || status.includes("error") || status.includes("broken")) {
    return "failed";
  }
  if (status.includes("pass") || status.includes("success")) return "passed";
  return null;
}

function recordName(record, fallback) {
  return boundedText(
    firstDefined(record, [
      "name",
      "title",
      "test",
      "testName",
      "testCase",
      "fullName",
      "fullTitle",
    ]),
    fallback,
    200
  );
}

function recordSuite(record, fallback) {
  return boundedText(
    firstDefined(record, [
      "suite",
      "suiteName",
      "testSuite",
      "module",
      "className",
      "feature",
      "file",
    ]),
    fallback,
    160
  );
}

function recordMessage(record) {
  const error = asRecord(record.error) || asRecord(record.err);
  return boundedText(
    firstDefined(record, [
      "message",
      "failureMessage",
      "failureMessages",
      "errorMessage",
      "reason",
      "stack",
    ]) ?? error?.message ?? error?.stack,
    "Failed",
    300
  );
}

function recordDuration(record, commonUnit = "seconds") {
  const seconds = firstDefined(record, [
    "durationSec",
    "duration_sec",
    "timeSec",
    "elapsedSec",
  ]);
  if (seconds !== undefined) return nonNegativeNumber(seconds);
  const milliseconds = firstDefined(record, ["durationMs", "duration_ms", "durationMillis"]);
  if (milliseconds !== undefined) return nonNegativeNumber(milliseconds) / 1000;
  const common = nonNegativeNumber(
    firstDefined(record, ["duration", "time", "elapsed"])
  );
  return commonUnit === "milliseconds" ? common / 1000 : common;
}

function collectRecords(
  value,
  suiteName,
  output,
  durationUnit = "seconds",
  inheritedTestName = ""
) {
  if (Array.isArray(value)) {
    value.forEach((entry) =>
      collectRecords(
        entry,
        suiteName,
        output,
        durationUnit,
        inheritedTestName
      )
    );
    return;
  }
  const record = asRecord(value);
  if (!record) return;

  const nestedSuite = recordSuite(record, suiteName);
  const ownTestName = firstDefined(record, [
    "name",
    "title",
    "test",
    "testName",
  ]);
  const contextualTestName =
    ownTestName !== undefined
      ? recordName(record, inheritedTestName || `Test ${output.length + 1}`)
      : inheritedTestName;
  const beforeNested = output.length;
  for (const key of [
    "assertionResults",
    "testcases",
    "testCases",
    "tests",
    "specs",
    "cases",
    "children",
  ]) {
    if (Array.isArray(record[key])) {
      collectRecords(
        record[key],
        nestedSuite,
        output,
        key === "assertionResults" ? "milliseconds" : durationUnit,
        key === "tests" && contextualTestName
          ? contextualTestName
          : inheritedTestName
      );
    }
  }
  if (output.length > beforeNested) return;

  const retries = Array.isArray(record.results)
    ? record.results.map(asRecord).filter(Boolean)
    : [];
  if (
    retries.length &&
    retries.every((attempt) =>
      normalizeStatus(firstDefined(attempt, ["status", "result", "outcome", "state"]))
    ) &&
    retries.every(
      (attempt) =>
        firstDefined(attempt, ["name", "title", "test", "testName"]) === undefined
    ) &&
    Boolean(contextualTestName)
  ) {
    const finalAttempt = retries[retries.length - 1];
    const attemptStatus = normalizeStatus(
      firstDefined(finalAttempt, ["status", "result", "outcome", "state"])
    );
    const overallStatusText = String(record.status || "").toLowerCase();
    const useOverallStatus =
      record.expectedStatus !== undefined ||
      record.projectName !== undefined ||
      ["expected", "unexpected", "flaky"].includes(overallStatusText);
    const finalStatus =
      (useOverallStatus ? normalizeStatus(record.status) : null) || attemptStatus;
    output.push({
      suite: recordSuite(record, suiteName),
      name: contextualTestName || `Test ${output.length + 1}`,
      status: finalStatus,
      message: finalStatus === "failed" ? recordMessage(finalAttempt) : "",
      durationSec: recordDuration(finalAttempt, "milliseconds"),
    });
    return;
  }

  const status = normalizeStatus(
    firstDefined(record, ["status", "result", "outcome", "state"])
  );
  if (status) {
    output.push({
      suite: nestedSuite,
      name:
        contextualTestName ||
        recordName(record, `Test ${output.length + 1}`),
      status,
      message: status === "failed" ? recordMessage(record) : "",
      durationSec: recordDuration(record, durationUnit),
    });
    return;
  }

  if (Array.isArray(record.results)) {
    collectRecords(
      record.results,
      nestedSuite,
      output,
      durationUnit,
      contextualTestName || inheritedTestName
    );
  }
}

function aggregateSuite(value, fallbackName) {
  const record = asRecord(value);
  if (!record) return null;
  const metric = (keys) => {
    for (const key of keys) {
      const candidate = record[key];
      if (
        typeof candidate === "number" ||
        (typeof candidate === "string" &&
          candidate.trim() !== "" &&
          Number.isFinite(Number(candidate)))
      ) {
        return candidate;
      }
    }
    return undefined;
  };
  const totalValue = metric([
    "total",
    "tests",
    "totalTests",
    "numTotalTests",
    "testCount",
  ]);
  const passedValue = metric([
    "passed",
    "passes",
    "numPassedTests",
    "success",
  ]);
  const failedValue = metric([
    "failed",
    "failures",
    "numFailedTests",
    "errors",
  ]);
  const skippedValue = metric([
    "skipped",
    "pending",
    "numPendingTests",
    "ignored",
    "disabled",
  ]);
  if (
    totalValue === undefined &&
    passedValue === undefined &&
    failedValue === undefined &&
    skippedValue === undefined
  ) {
    return null;
  }
  const failed = nonNegativeInteger(failedValue);
  const skipped = nonNegativeInteger(skippedValue);
  const providedTotal = nonNegativeInteger(totalValue);
  const passed =
    passedValue !== undefined
      ? nonNegativeInteger(passedValue)
      : Math.max(providedTotal - failed - skipped, 0);
  return {
    name: boundedText(
      firstDefined(record, ["name", "title", "suite", "suiteName", "module"]),
      fallbackName,
      160
    ),
    total: Math.max(providedTotal, passed + failed + skipped),
    passed,
    failed,
    skipped,
  };
}

function explicitFailures(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(asRecord)
    .filter(Boolean)
    .map((failure) => {
      const suite = recordSuite(failure, "Test report");
      const test = recordName(failure, "unnamed test");
      const message = recordMessage(failure);
      return {
        suite,
        test,
        message,
        highImpact:
          Boolean(failure.highImpact) || isHighImpact(`${suite} ${test} ${message}`),
      };
    });
}

function recordsToParts(records) {
  const suites = new Map();
  const failures = [];
  let durationSec = 0;
  for (const record of records) {
    const suite =
      suites.get(record.suite) ||
      { name: record.suite, total: 0, passed: 0, failed: 0, skipped: 0 };
    suite.total += 1;
    suite[record.status] += 1;
    suites.set(record.suite, suite);
    durationSec += record.durationSec;
    if (record.status === "failed") {
      failures.push({
        suite: record.suite,
        test: record.name,
        message: record.message || "Failed",
        highImpact: isHighImpact(`${record.suite} ${record.name} ${record.message}`),
      });
    }
  }
  return { suites: [...suites.values()], failures, durationSec };
}

function parseJSONReport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`Malformed JSON: ${error.message || "Invalid JSON."}`);
  }
  const root = asRecord(data);
  const container =
    root && asRecord(root.report) && !root.suites && !root.testsuites
      ? root.report
      : root;

  if (
    container?.format === NORMALIZED_REPORT_FORMAT &&
    Array.isArray(container.suites)
  ) {
    const suites = container.suites
      .map((suite, index) => aggregateSuite(suite, `Suite ${index + 1}`))
      .filter(Boolean);
    if (!suites.length) throw new Error("The normalized report has no valid suites.");
    return finalize(
      suites,
      explicitFailures(container.failures),
      nonNegativeNumber(container.durationSec)
    );
  }

  let rawSuites = Array.isArray(data)
    ? data
    : container?.suites ||
      container?.testsuites ||
      container?.testResults ||
      null;
  if (
    Array.isArray(rawSuites) &&
    rawSuites.length &&
    rawSuites.every((entry) => {
      const record = asRecord(entry) || {};
      const hasNestedTests = [
        "assertionResults",
        "testcases",
        "testCases",
        "tests",
        "specs",
        "cases",
        "children",
      ].some((key) => Array.isArray(record[key]));
      return (
        !hasNestedTests &&
        normalizeStatus(
          firstDefined(record, ["status", "result", "outcome", "state"])
        )
      );
    })
  ) {
    rawSuites = [{ name: "Test report", results: rawSuites }];
  }

  if (Array.isArray(rawSuites)) {
    const suites = [];
    const failures = [];
    let durationSec = 0;
    rawSuites.forEach((rawSuite, index) => {
      const suiteRecord = asRecord(rawSuite);
      if (!suiteRecord) return;
      const suiteName = boundedText(
        firstDefined(suiteRecord, [
          "name",
          "title",
          "suite",
          "suiteName",
          "module",
          "testFilePath",
        ]),
        `Suite ${index + 1}`,
        160
      );
      const records = [];
      collectRecords(suiteRecord, suiteName, records);
      if (records.length) {
        const detail = recordsToParts(records);
        suites.push(...detail.suites);
        failures.push(...detail.failures);
        durationSec += detail.durationSec;
      } else {
        const aggregate = aggregateSuite(suiteRecord, suiteName);
        if (aggregate) {
          suites.push(aggregate);
          durationSec += nonNegativeNumber(
            firstDefined(suiteRecord, ["duration", "time", "durationSec"])
          );
        }
      }
    });
    if (suites.length) {
      return finalize(
        suites,
        failures.length ? failures : explicitFailures(container?.failures),
        durationSec
      );
    }
  }

  if (container) {
    const records = [];
    for (const key of [
      "assertionResults",
      "testcases",
      "testCases",
      "tests",
      "specs",
      "results",
    ]) {
      if (Array.isArray(container[key])) {
        collectRecords(container[key], "Test report", records);
      }
    }
    if (records.length) {
      const detail = recordsToParts(records);
      return finalize(detail.suites, detail.failures, detail.durationSec);
    }

    const stats = asRecord(container.stats);
    const aggregate =
      aggregateSuite(container, "Test report") ||
      aggregateSuite(stats, "Test report");
    if (aggregate) {
      const statsDuration =
        stats?.duration !== undefined ? nonNegativeNumber(stats.duration) / 1000 : 0;
      return finalize(
        [aggregate],
        explicitFailures(container.failures),
        statsDuration ||
          nonNegativeNumber(
            firstDefined(container, ["durationSec", "duration", "time"])
          )
      );
    }
  }

  throw new Error("Expected JSON test results, suite counts, or a normalized report.");
}

function summaryCandidate(line) {
  const values = {};
  const seen = new Set();
  const setValue = (label, count) => {
    const normalized = label.toLowerCase();
    if (normalized.startsWith("pass")) values.passed = count;
    else if (
      normalized.startsWith("fail") ||
      normalized.startsWith("error") ||
      normalized === "xpassed"
    ) {
      values.failed = (values.failed || 0) + count;
    } else if (
      normalized.startsWith("skip") ||
      normalized.startsWith("pend") ||
      normalized.startsWith("ignor") ||
      normalized === "xfailed"
    ) {
      values.skipped = count;
    } else if (normalized.startsWith("total")) values.total = count;
    seen.add(normalized.replace(/s$/, ""));
  };

  for (const match of line.matchAll(
    /(\d+)\s+(passed|passing|failed|failing|failures?|errors?|skipped|pending|ignored|xfailed|xpassed|total(?:\s+tests?)?)/gi
  )) {
    setValue(match[2], Number(match[1]));
  }
  for (const match of line.matchAll(
    /(passed|passing|failed|failing|failures?|errors?|skipped|pending|ignored|xfailed|xpassed|total(?:\s+tests?)?)\s*[:=]\s*(\d+)/gi
  )) {
    setValue(match[1], Number(match[2]));
  }
  return seen.size
    ? {
        ...values,
        score:
          seen.size * 10 +
          (values.total !== undefined ? 5 : 0) +
          (/^\s*Tests\s*:/i.test(line) ? 100 : 0),
      }
    : null;
}

function parseStatusLines(text) {
  const records = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    const leading = trimmed.match(
      /^(?:\[\s*)?(PASS(?:ED)?|FAIL(?:ED)?|ERROR|SKIP(?:PED)?|PENDING)(?:\s*\])?[\s:|\-]+(.+)$/i
    );
    const trailing = trimmed.match(
      /^(.+?)[\s|:,-]+(PASS(?:ED)?|FAIL(?:ED)?|ERROR|SKIP(?:PED)?|PENDING)$/i
    );
    const match = leading || trailing;
    if (!match) continue;
    const status = normalizeStatus(leading ? match[1] : match[2]);
    const name = leading ? match[2] : match[1];
    if (!status) continue;
    records.push({
      suite: "Test report",
      name,
      status,
      message: status === "failed" ? "See report for details" : "",
      durationSec: 0,
    });
  }
  return records.length ? recordsToParts(records) : null;
}

function parseLog(text) {
  const surefire = text.match(
    /Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)/i
  );
  let total;
  let failed;
  let skipped;
  let passed;

  if (surefire) {
    total = Number(surefire[1]);
    failed = Number(surefire[2]) + Number(surefire[3]);
    skipped = Number(surefire[4]);
    passed = Math.max(total - failed - skipped, 0);
  } else {
    const candidates = text
      .split(/\r?\n/)
      .map(summaryCandidate)
      .filter(Boolean)
      .sort((left, right) => right.score - left.score);
    const candidate = candidates[0];
    if (!candidate) {
      const detail = parseStatusLines(text);
      if (detail) return finalize(detail.suites, detail.failures, 0);
      throw new Error(
        "Could not recognize test results in this text. Include a pass/fail summary."
      );
    }
    failed = candidate.failed || 0;
    skipped = candidate.skipped || 0;
    passed = candidate.passed || 0;
    total = candidate.total ?? passed + failed + skipped;
    if (candidate.passed === undefined) passed = Math.max(total - failed - skipped, 0);
    total = Math.max(total, passed + failed + skipped);
  }

  const failNames = [
    ...text.matchAll(
      /^(?:FAILED|FAIL|ERROR|\[\s*FAIL(?:ED)?\s*\])[\s:|\-]+(.+)$/gim
    ),
  ].map((match) => match[1].trim());
  const failures = failNames.slice(0, 500).map((name) => ({
    suite: "Test report",
    test: name,
    message: "See report for details",
    highImpact: isHighImpact(name),
  }));
  const durationMatch =
    text.match(/\b(?:duration|time|elapsed)\s*[:=]\s*([0-9.]+)\s*(ms|s|sec)?/i) ||
    text.match(/\bin\s+([0-9.]+)\s*(ms|s|sec)\b/i);
  const durationSec = durationMatch
    ? Number(durationMatch[1]) / (durationMatch[2]?.toLowerCase() === "ms" ? 1000 : 1)
    : 0;
  return finalize(
    [{ name: "Test report", total, passed, failed, skipped }],
    failures,
    durationSec
  );
}

export function parseReport(rawText) {
  const text = rawText.replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error("The report is empty.");
  if (text.startsWith("<")) return parseXML(text);
  if (text.startsWith("{") || text.startsWith("[")) return parseJSONReport(text);
  return parseLog(text);
}

export function serializeReport(report) {
  return JSON.stringify({
    format: NORMALIZED_REPORT_FORMAT,
    ...report,
  });
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
