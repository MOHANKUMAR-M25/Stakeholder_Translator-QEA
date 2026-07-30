import { XMLParser, XMLValidator } from "fast-xml-parser";
import {
  asNonNegativeInteger,
  asNonNegativeNumber,
  boundedText,
  finalizeReport,
  isHighImpact,
} from "./model.js";
import type {
  ParsedFailure,
  ParsedReport,
  ParsedSuite,
} from "./model.js";

export type {
  ParsedFailure,
  ParsedReport,
  ParsedSuite,
} from "./model.js";

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function directTestCases(suite: Record<string, unknown>): Record<string, unknown>[] {
  return asArray(suite.testcase as Record<string, unknown> | Record<string, unknown>[] | undefined);
}

function collectLeafSuites(node: unknown, output: Record<string, unknown>[]): void {
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  const children = asArray(
    record.testsuite as Record<string, unknown> | Record<string, unknown>[] | undefined
  );

  if (children.length > 0) {
    for (const child of children) collectLeafSuites(child, output);
    if (directTestCases(record).length > 0) output.push(record);
    return;
  }

  if (
    "testcase" in record ||
    "@_tests" in record ||
    "@_failures" in record ||
    "@_errors" in record
  ) {
    output.push(record);
    return;
  }

  for (const [key, value] of Object.entries(record)) {
    if (key.startsWith("@_") || key === "testcase") continue;
    collectLeafSuites(value, output);
  }
}

function nestedMessage(node: unknown): string {
  if (!node || typeof node !== "object") return boundedText(node, "Failed");
  const record = node as Record<string, unknown>;
  return boundedText(
    record["@_message"] ??
      record.message ??
      record["full-stacktrace"] ??
      record["#text"] ??
      record,
    "Failed"
  );
}

function parseJUnitDocument(doc: Record<string, unknown>): ParsedReport | null {
  const suiteNodes: Record<string, unknown>[] = [];
  collectLeafSuites(doc, suiteNodes);
  if (suiteNodes.length === 0) return null;

  const suites: ParsedSuite[] = [];
  const failures: ParsedFailure[] = [];
  let durationSec = 0;

  for (const suiteNode of suiteNodes) {
    const name = boundedText(suiteNode["@_name"], "Suite", 160);
    const testCases = directTestCases(suiteNode);
    let observedPassed = 0;
    let observedFailed = 0;
    let observedSkipped = 0;
    let observedDuration = 0;

    for (const testCase of testCases) {
      const failureNode = testCase.failure ?? testCase.error;
      const skippedNode = testCase.skipped;
      const testName = boundedText(testCase["@_name"], "unnamed test", 200);
      observedDuration += asNonNegativeNumber(testCase["@_time"]);

      if (failureNode !== undefined) {
        observedFailed += 1;
        const message = nestedMessage(failureNode);
        failures.push({
          suite: name,
          test: testName,
          message,
          highImpact: isHighImpact(`${name} ${testName} ${message}`),
        });
      } else if (skippedNode !== undefined) {
        observedSkipped += 1;
      } else {
        observedPassed += 1;
      }
    }

    const declaredFailed =
      asNonNegativeInteger(suiteNode["@_failures"]) +
      asNonNegativeInteger(suiteNode["@_errors"]);
    const failed = Math.max(declaredFailed, observedFailed);
    const skipped = Math.max(
      asNonNegativeInteger(suiteNode["@_skipped"]),
      observedSkipped
    );
    const declaredTotal = asNonNegativeInteger(suiteNode["@_tests"]);
    const total = Math.max(
      declaredTotal,
      testCases.length,
      observedPassed + failed + skipped
    );
    const passed = Math.max(total - failed - skipped, observedPassed, 0);
    const declaredDuration = asNonNegativeNumber(suiteNode["@_time"]);
    durationSec += declaredDuration || observedDuration;

    suites.push({ name, total, passed, failed, skipped });
  }

  return finalizeReport(suites, failures, durationSec);
}

interface TestNgAccumulator {
  suiteName: string;
  suites: Map<string, ParsedSuite>;
  failures: ParsedFailure[];
  durationSec: number;
}

function visitTestNg(node: unknown, state: TestNgAccumulator): void {
  if (Array.isArray(node)) {
    for (const entry of node) visitTestNg(entry, state);
    return;
  }
  if (!node || typeof node !== "object") return;

  const record = node as Record<string, unknown>;

  for (const suite of asArray(record.suite as Record<string, unknown> | Record<string, unknown>[] | undefined)) {
    const previous = state.suiteName;
    state.suiteName = boundedText(suite["@_name"], previous || "TestNG", 160);
    visitTestNg(suite, state);
    state.suiteName = previous;
  }

  for (const method of asArray(
    record["test-method"] as Record<string, unknown> | Record<string, unknown>[] | undefined
  )) {
    if (String(method["@_is-config"] ?? "").toLowerCase() === "true") continue;

    const status = String(method["@_status"] ?? "").trim().toLowerCase();
    if (!status) continue;

    const suiteName = state.suiteName || "TestNG";
    const suite =
      state.suites.get(suiteName) ??
      { name: suiteName, total: 0, passed: 0, failed: 0, skipped: 0 };
    const testName = boundedText(method["@_name"], "unnamed test", 200);
    suite.total += 1;

    if (status.includes("pass")) {
      suite.passed += 1;
    } else if (status.includes("fail")) {
      suite.failed += 1;
      const message = nestedMessage(method.exception ?? method);
      state.failures.push({
        suite: suiteName,
        test: testName,
        message,
        highImpact: isHighImpact(`${suiteName} ${testName} ${message}`),
      });
    } else {
      suite.skipped += 1;
    }

    state.durationSec +=
      asNonNegativeNumber(method["@_duration-ms"]) / 1000 ||
      asNonNegativeNumber(method["@_time"]);
    state.suites.set(suiteName, suite);
  }

  for (const [key, value] of Object.entries(record)) {
    if (key === "suite" || key === "test-method" || key.startsWith("@_")) continue;
    visitTestNg(value, state);
  }
}

function parseTestNgDocument(doc: Record<string, unknown>): ParsedReport | null {
  if (!("testng-results" in doc)) return null;

  const state: TestNgAccumulator = {
    suiteName: "TestNG",
    suites: new Map(),
    failures: [],
    durationSec: 0,
  };
  visitTestNg(doc["testng-results"], state);
  if (state.suites.size === 0) {
    throw new Error("No TestNG <test-method> results were found.");
  }
  return finalizeReport([...state.suites.values()], state.failures, state.durationSec);
}

export function parseJUnitXML(xml: string): ParsedReport {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error("XML document types and entities are not supported.");
  }

  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    const detail =
      typeof validation === "object" && validation.err?.msg
        ? ` ${validation.err.msg}`
        : "";
    throw new Error(`Malformed XML.${detail}`.trim());
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    removeNSPrefix: true,
  });
  const doc = parser.parse(xml) as Record<string, unknown>;

  const testNg = parseTestNgDocument(doc);
  if (testNg) return testNg;

  const junit = parseJUnitDocument(doc);
  if (junit) return junit;

  throw new Error(
    "No JUnit <testsuite> or TestNG <test-method> results were found."
  );
}
