import type {
  ParsedFailure,
  ParsedReport,
  ParsedSuite,
} from "./model.js";
import {
  NORMALIZED_REPORT_FORMAT,
  asNonNegativeInteger,
  asNonNegativeNumber,
  boundedText,
  finalizeReport,
  isHighImpact,
} from "./model.js";
import { parseJUnitXML } from "./junit.js";

export interface TabularSource {
  name: string;
  rows: unknown[][];
}

type TestStatus = "passed" | "failed" | "skipped";

interface TabularResult {
  mode: "detail" | "aggregate";
  suites: ParsedSuite[];
  failures: ParsedFailure[];
  durationSec: number;
}

interface TestRecord {
  suite: string;
  name: string;
  status: TestStatus;
  message: string;
  durationSec: number;
}

const MAX_TABULAR_ROWS = 10_000;
const MAX_TABULAR_COLUMNS = 100;
const MAX_TABULAR_CELLS = 200_000;

const HEADER_ALIASES = {
  test: new Set([
    "test",
    "testcase",
    "testcasename",
    "testname",
    "case",
    "casename",
    "name",
    "title",
    "scenario",
    "spec",
    "method",
  ]),
  suite: new Set([
    "suite",
    "suitename",
    "testsuite",
    "testsuitename",
    "module",
    "class",
    "feature",
    "component",
    "project",
    "group",
  ]),
  status: new Set([
    "status",
    "teststatus",
    "result",
    "testresult",
    "outcome",
    "state",
  ]),
  message: new Set([
    "message",
    "errormessage",
    "failuremessage",
    "error",
    "failure",
    "details",
    "detail",
    "reason",
    "stacktrace",
  ]),
  duration: new Set([
    "duration",
    "durationsec",
    "durationseconds",
    "durationms",
    "time",
    "timesec",
    "timems",
    "elapsed",
    "elapsedtime",
    "executiontime",
  ]),
  total: new Set(["total", "tests", "testcount", "totaltests", "count"]),
  passed: new Set(["passed", "pass", "passes", "success", "successful"]),
  failed: new Set(["failed", "fail", "fails", "failures", "errors"]),
  skipped: new Set([
    "skipped",
    "skip",
    "pending",
    "ignored",
    "disabled",
    "notrun",
  ]),
};

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function findColumn(headers: unknown[], aliases: Set<string>): number {
  return headers.findIndex((header) => aliases.has(normalizeHeader(header)));
}

function cell(row: unknown[], index: number): unknown {
  return index >= 0 ? row[index] : undefined;
}

function isBlankRow(row: unknown[]): boolean {
  return row.every((value) => String(value ?? "").trim() === "");
}

function normalizeStatus(value: unknown): TestStatus | null {
  if (typeof value === "boolean") return value ? "passed" : "failed";
  const status = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (!status) return null;

  if (
    /^(skip(?:ped)?|pending|ignored?|disabled|not run|not executed|blocked|todo|xfailed)$/.test(
      status
    )
  ) {
    return "skipped";
  }
  if (
    /^(fail(?:ed|ure)?|error|errored|broken|ko|not passed|unsuccessful|xpassed|unexpected|timed out|timedout|interrupted)$/.test(
      status
    )
  ) {
    return "failed";
  }
  if (
    /^(pass(?:ed|ing)?|success(?:ful)?|ok|green|complete(?:d)?|succeeded|expected|flaky)$/.test(
      status
    )
  ) {
    return "passed";
  }

  if (status.includes("skip") || status.includes("pending")) return "skipped";
  if (
    status.includes("fail") ||
    status.includes("error") ||
    status.includes("broken")
  ) {
    return "failed";
  }
  if (status.includes("pass") || status.includes("success")) return "passed";
  return null;
}

function numericCell(value: unknown): number {
  if (typeof value === "number") return asNonNegativeNumber(value);
  const match = String(value ?? "")
    .replace(/,/g, "")
    .match(/-?\d+(?:\.\d+)?/);
  return match ? asNonNegativeNumber(match[0]) : 0;
}

function durationSeconds(value: unknown, header: unknown = ""): number {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number") {
    return normalizeHeader(header).endsWith("ms") ? value / 1000 : value;
  }

  const text = String(value).trim().toLowerCase();
  if (!text) return 0;

  if (/^\d{1,3}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(text)) {
    const parts = text.split(":").map(Number);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  let seconds = 0;
  const hours = text.match(/(\d+(?:\.\d+)?)\s*h(?:ours?)?/);
  const minutes = text.match(/(\d+(?:\.\d+)?)\s*m(?:in(?:utes?)?)?(?!s)/);
  const secondPart = text.match(/(\d+(?:\.\d+)?)\s*s(?:ec(?:onds?)?)?/);
  const milliseconds = text.match(/(\d+(?:\.\d+)?)\s*ms/);
  if (hours) seconds += Number(hours[1]) * 3600;
  if (minutes) seconds += Number(minutes[1]) * 60;
  if (secondPart) seconds += Number(secondPart[1]);
  if (milliseconds) seconds += Number(milliseconds[1]) / 1000;
  if (seconds > 0) return seconds;

  const number = numericCell(text);
  return text.includes("ms") || normalizeHeader(header).endsWith("ms")
    ? number / 1000
    : number;
}

function tableLimits(sources: TabularSource[]): void {
  let cells = 0;
  for (const source of sources) {
    if (source.rows.length > MAX_TABULAR_ROWS + 20) {
      throw new Error(
        `The table "${source.name}" exceeds the ${MAX_TABULAR_ROWS.toLocaleString()} row limit.`
      );
    }
    for (const row of source.rows) {
      if (!Array.isArray(row)) {
        throw new Error(`The table "${source.name}" contains an invalid row.`);
      }
      if (row.length > MAX_TABULAR_COLUMNS) {
        throw new Error(
          `The table "${source.name}" exceeds the ${MAX_TABULAR_COLUMNS} column limit.`
        );
      }
      cells += row.length;
      if (cells > MAX_TABULAR_CELLS) {
        throw new Error(
          `The report exceeds the ${MAX_TABULAR_CELLS.toLocaleString()} cell limit.`
        );
      }
    }
  }
}

function parseDetailedTable(source: TabularSource): TabularResult | null {
  const headerLimit = Math.min(source.rows.length, 15);

  for (let headerIndex = 0; headerIndex < headerLimit; headerIndex += 1) {
    const headers = source.rows[headerIndex];
    const statusIndex = findColumn(headers, HEADER_ALIASES.status);
    const testIndex = findColumn(headers, HEADER_ALIASES.test);
    if (statusIndex < 0 || testIndex < 0) continue;

    const suiteIndex = findColumn(headers, HEADER_ALIASES.suite);
    const messageIndex = findColumn(headers, HEADER_ALIASES.message);
    const durationIndex = findColumn(headers, HEADER_ALIASES.duration);
    const suites = new Map<string, ParsedSuite>();
    const failures: ParsedFailure[] = [];
    let durationSec = 0;
    let recognizedRows = 0;

    for (const row of source.rows.slice(headerIndex + 1)) {
      if (isBlankRow(row)) continue;
      const status = normalizeStatus(cell(row, statusIndex));
      if (!status) continue;

      const suiteName = boundedText(
        cell(row, suiteIndex),
        source.name || "Test report",
        160
      );
      const testName = boundedText(
        cell(row, testIndex),
        `Test ${recognizedRows + 1}`,
        200
      );
      const suite =
        suites.get(suiteName) ??
        { name: suiteName, total: 0, passed: 0, failed: 0, skipped: 0 };
      suite.total += 1;
      suite[status] += 1;
      suites.set(suiteName, suite);
      recognizedRows += 1;

      const rowDuration = durationSeconds(
        cell(row, durationIndex),
        cell(headers, durationIndex)
      );
      durationSec += rowDuration;

      if (status === "failed") {
        const message = boundedText(
          cell(row, messageIndex),
          "Failed",
          300
        );
        failures.push({
          suite: suiteName,
          test: testName,
          message,
          highImpact: isHighImpact(`${suiteName} ${testName} ${message}`),
        });
      }
    }

    if (recognizedRows > 0) {
      return {
        mode: "detail",
        suites: [...suites.values()],
        failures,
        durationSec,
      };
    }
  }

  return null;
}

function parseAggregateTable(source: TabularSource): TabularResult | null {
  const headerLimit = Math.min(source.rows.length, 15);

  for (let headerIndex = 0; headerIndex < headerLimit; headerIndex += 1) {
    const headers = source.rows[headerIndex];
    const totalIndex = findColumn(headers, HEADER_ALIASES.total);
    const passedIndex = findColumn(headers, HEADER_ALIASES.passed);
    const failedIndex = findColumn(headers, HEADER_ALIASES.failed);
    const skippedIndex = findColumn(headers, HEADER_ALIASES.skipped);
    if (
      totalIndex < 0 ||
      (passedIndex < 0 && failedIndex < 0 && skippedIndex < 0)
    ) {
      continue;
    }

    const suiteIndex = findColumn(headers, HEADER_ALIASES.suite);
    const fallbackNameIndex = findColumn(headers, HEADER_ALIASES.test);
    const nameIndex = suiteIndex >= 0 ? suiteIndex : fallbackNameIndex;
    const durationIndex = findColumn(headers, HEADER_ALIASES.duration);
    const candidates: Array<ParsedSuite & { durationSec: number }> = [];

    for (const row of source.rows.slice(headerIndex + 1)) {
      if (isBlankRow(row)) continue;
      const total = asNonNegativeInteger(numericCell(cell(row, totalIndex)));
      const failed = asNonNegativeInteger(numericCell(cell(row, failedIndex)));
      const skipped = asNonNegativeInteger(numericCell(cell(row, skippedIndex)));
      const explicitPassed = asNonNegativeInteger(
        numericCell(cell(row, passedIndex))
      );
      const passed =
        passedIndex >= 0
          ? explicitPassed
          : Math.max(total - failed - skipped, 0);
      if (total === 0 && passed + failed + skipped === 0) continue;

      candidates.push({
        name: boundedText(cell(row, nameIndex), source.name || "Test report", 160),
        total: Math.max(total, passed + failed + skipped),
        passed,
        failed,
        skipped,
        durationSec: durationSeconds(
          cell(row, durationIndex),
          cell(headers, durationIndex)
        ),
      });
    }

    if (candidates.length === 0) continue;
    const filtered =
      candidates.length > 1
        ? candidates.filter(
            (candidate) =>
              !/^(grand\s*total|overall|all|summary|total)$/i.test(candidate.name)
          )
        : candidates;
    const selected = filtered.length > 0 ? filtered : candidates;

    return {
      mode: "aggregate",
      suites: selected.map(({ durationSec: _duration, ...suite }) => suite),
      failures: [],
      durationSec: selected.reduce(
        (sum, candidate) => sum + candidate.durationSec,
        0
      ),
    };
  }

  return null;
}

export function parseTabularSources(sources: TabularSource[]): ParsedReport {
  tableLimits(sources);
  const detailed: TabularResult[] = [];
  const aggregate: TabularResult[] = [];

  for (const source of sources) {
    const detail = parseDetailedTable(source);
    if (detail) {
      detailed.push(detail);
      continue;
    }
    const summary = parseAggregateTable(source);
    if (summary) aggregate.push(summary);
  }

  if (detailed.length > 0 && aggregate.length > 0) {
    const aggregateDuration = aggregate.reduce(
      (sum, result) => sum + result.durationSec,
      0
    );
    return finalizeReport(
      aggregate.flatMap((result) => result.suites),
      detailed.flatMap((result) => result.failures),
      aggregateDuration ||
        detailed.reduce((sum, result) => sum + result.durationSec, 0)
    );
  }

  const selected = detailed.length > 0 ? detailed : aggregate;
  if (selected.length === 0) {
    throw new Error(
      "No recognizable test table was found. Include test/name and status/result columns, or suite totals with passed/failed/skipped counts."
    );
  }

  return finalizeReport(
    selected.flatMap((result) => result.suites),
    selected.flatMap((result) => result.failures),
    selected.reduce((sum, result) => sum + result.durationSec, 0)
  );
}

function countDelimiterOutsideQuotes(line: string, delimiter: string): number {
  let quoted = false;
  let count = 0;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') {
      if (quoted && line[index + 1] === '"') {
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && line[index] === delimiter) {
      count += 1;
    }
  }
  return count;
}

function detectDelimiter(text: string): string {
  const sampleLines = text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .slice(0, 8);
  const candidates = [",", "\t", ";", "|"];
  let winner = ",";
  let winningScore = -1;

  for (const delimiter of candidates) {
    const counts = sampleLines.map((line) =>
      countDelimiterOutsideQuotes(line, delimiter)
    );
    const nonZero = counts.filter((count) => count > 0);
    const score =
      nonZero.length === 0
        ? 0
        : nonZero.length * 10 + Math.min(...nonZero) - Math.max(...nonZero);
    if (score > winningScore) {
      winner = delimiter;
      winningScore = score;
    }
  }
  return winner;
}

export function parseDelimitedRows(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(input);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    if (!isBlankRow(row)) rows.push(row);
    row = [];
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (quoted || field.trim() === "") {
        quoted = !quoted;
      } else {
        field += character;
      }
      continue;
    }
    if (!quoted && character === delimiter) {
      pushField();
      continue;
    }
    if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      pushRow();
      continue;
    }
    field += character;
  }

  if (quoted) throw new Error("Malformed delimited report: an opening quote is not closed.");
  if (field.length > 0 || row.length > 0) pushRow();
  return rows;
}

export function parseDelimitedReport(text: string): ParsedReport {
  return parseTabularSources([{ name: "Test report", rows: parseDelimitedRows(text) }]);
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(
    /&(#x?[0-9a-f]+|[a-z]+);/gi,
    (entity, key: string) => {
      if (key[0] === "#") {
        const hexadecimal = key[1]?.toLowerCase() === "x";
        const codePoint = Number.parseInt(key.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
      }
      return named[key.toLowerCase()] ?? entity;
    }
  );
}

function htmlCellText(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<(br|\/p|\/div|\/li)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function htmlPlainText(html: string): string {
  return htmlCellText(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|template|svg)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<(br|\/p|\/div|\/tr|\/li|\/h[1-6]|\/pre)\b[^>]*>/gi, "\n")
  );
}

export function parseHTMLReport(html: string): ParsedReport {
  const inert = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|template|svg)\b[\s\S]*?<\/\1\s*>/gi, "");
  const sources: TabularSource[] = [];
  const tableMatches = inert.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi);
  let tableNumber = 0;

  for (const tableMatch of tableMatches) {
    tableNumber += 1;
    const rows: string[][] = [];
    for (const rowMatch of tableMatch[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)) {
      const cells = [
        ...rowMatch[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]\s*>/gi),
      ].map((match) => htmlCellText(match[1]));
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length > 0) {
      sources.push({ name: `HTML table ${tableNumber}`, rows });
    }
  }

  if (sources.length > 0) {
    try {
      return parseTabularSources(sources);
    } catch {
      // Some reports use layout-only tables; fall through to their visible summary text.
    }
  }

  return parseLogReport(htmlPlainText(inert));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstDefined(
  record: Record<string, unknown>,
  keys: string[]
): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function recordName(record: Record<string, unknown>, fallback: string): string {
  return boundedText(
    firstDefined(record, [
      "name",
      "title",
      "test",
      "testName",
      "testCase",
      "fullName",
      "fullTitle",
      "ancestorTitles",
    ]),
    fallback,
    200
  );
}

function recordMessage(record: Record<string, unknown>): string {
  const error = asRecord(record.error) ?? asRecord(record.err);
  return boundedText(
    firstDefined(record, [
      "message",
      "failureMessage",
      "failureMessages",
      "errorMessage",
      "reason",
      "stack",
    ]) ??
      error?.message ??
      error?.stack,
    "Failed",
    300
  );
}

function recordDuration(
  record: Record<string, unknown>,
  commonUnit: "seconds" | "milliseconds" = "seconds"
): number {
  const seconds = firstDefined(record, [
    "durationSec",
    "duration_sec",
    "timeSec",
    "elapsedSec",
  ]);
  if (seconds !== undefined) return asNonNegativeNumber(seconds);
  const milliseconds = firstDefined(record, [
    "durationMs",
    "duration_ms",
    "durationMillis",
  ]);
  if (milliseconds !== undefined) return asNonNegativeNumber(milliseconds) / 1000;
  const commonMilliseconds = firstDefined(record, ["duration", "time", "elapsed"]);
  const common = asNonNegativeNumber(commonMilliseconds);
  return commonUnit === "milliseconds" ? common / 1000 : common;
}

function recordSuite(record: Record<string, unknown>, fallback: string): string {
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

function collectTestRecords(
  value: unknown,
  suiteName: string,
  output: TestRecord[],
  durationUnit: "seconds" | "milliseconds" = "seconds",
  inheritedTestName = ""
): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectTestRecords(
        entry,
        suiteName,
        output,
        durationUnit,
        inheritedTestName
      );
    }
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
      collectTestRecords(
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

  const retryResults = Array.isArray(record.results)
    ? record.results.map(asRecord).filter((entry): entry is Record<string, unknown> => Boolean(entry))
    : [];
  if (
    retryResults.length > 0 &&
    retryResults.every((entry) =>
      Boolean(normalizeStatus(firstDefined(entry, ["status", "result", "outcome", "state"])))
    ) &&
    retryResults.every(
      (entry) =>
        firstDefined(entry, ["name", "title", "test", "testName"]) === undefined
    ) &&
    Boolean(contextualTestName)
  ) {
    const finalAttempt = retryResults[retryResults.length - 1];
    const attemptStatus = normalizeStatus(
      firstDefined(finalAttempt, ["status", "result", "outcome", "state"])
    );
    const overallStatusText = String(record.status ?? "").toLowerCase();
    const useOverallStatus =
      record.expectedStatus !== undefined ||
      record.projectName !== undefined ||
      ["expected", "unexpected", "flaky"].includes(overallStatusText);
    const finalStatus =
      (useOverallStatus ? normalizeStatus(record.status) : null) ?? attemptStatus;
    if (finalStatus) {
      output.push({
        suite: recordSuite(record, suiteName),
        name: contextualTestName || `Test ${output.length + 1}`,
        status: finalStatus,
        message: finalStatus === "failed" ? recordMessage(finalAttempt) : "",
        durationSec: recordDuration(finalAttempt, "milliseconds"),
      });
      return;
    }
  }

  const statusValue = firstDefined(record, ["status", "result", "outcome", "state"]);
  const status = normalizeStatus(statusValue);
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
    collectTestRecords(
      record.results,
      nestedSuite,
      output,
      durationUnit,
      contextualTestName || inheritedTestName
    );
  }
}

function recordsToResult(records: TestRecord[]): TabularResult {
  const suites = new Map<string, ParsedSuite>();
  const failures: ParsedFailure[] = [];
  let durationSec = 0;

  for (const record of records) {
    const suite =
      suites.get(record.suite) ??
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
        highImpact: isHighImpact(
          `${record.suite} ${record.name} ${record.message}`
        ),
      });
    }
  }

  return {
    mode: "detail",
    suites: [...suites.values()],
    failures,
    durationSec,
  };
}

function aggregateSuite(
  value: unknown,
  fallbackName: string
): ParsedSuite | null {
  const record = asRecord(value);
  if (!record) return null;

  const metric = (keys: string[]) => {
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

  const failed = asNonNegativeInteger(failedValue);
  const skipped = asNonNegativeInteger(skippedValue);
  const providedPassed = asNonNegativeInteger(passedValue);
  const providedTotal = asNonNegativeInteger(totalValue);
  const passed =
    passedValue !== undefined
      ? providedPassed
      : Math.max(providedTotal - failed - skipped, 0);
  const total = Math.max(providedTotal, passed + failed + skipped);

  return {
    name: boundedText(
      firstDefined(record, ["name", "title", "suite", "suiteName", "module"]),
      fallbackName,
      160
    ),
    total,
    passed,
    failed,
    skipped,
  };
}

function topLevelFailures(value: unknown): ParsedFailure[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((failure) => {
      const suite = recordSuite(failure, "Test report");
      const test = recordName(failure, "unnamed test");
      const message = recordMessage(failure);
      return {
        suite,
        test,
        message,
        highImpact:
          Boolean(failure.highImpact) ||
          isHighImpact(`${suite} ${test} ${message}`),
      };
    });
}

function parseJsonValue(data: unknown): ParsedReport {
  const root = asRecord(data);
  const container =
    root && asRecord(root.report) && !root.suites && !root.testsuites
      ? (root.report as Record<string, unknown>)
      : root;

  if (
    container?.format === NORMALIZED_REPORT_FORMAT &&
    Array.isArray(container.suites)
  ) {
    const suites = container.suites
      .map((suite, index) => aggregateSuite(suite, `Suite ${index + 1}`))
      .filter((suite): suite is ParsedSuite => Boolean(suite));
    if (suites.length === 0) {
      throw new Error("The normalized JSON report does not contain valid suites.");
    }
    return finalizeReport(
      suites,
      topLevelFailures(container.failures),
      asNonNegativeNumber(container.durationSec)
    );
  }

  const rawSuites = Array.isArray(data)
    ? data
    : Array.isArray(container?.suites)
      ? container.suites
      : Array.isArray(container?.testsuites)
        ? container.testsuites
        : Array.isArray(container?.testResults)
          ? container.testResults
          : null;

  if (rawSuites) {
    const suites: ParsedSuite[] = [];
    const failures: ParsedFailure[] = [];
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
      const records: TestRecord[] = [];
      collectTestRecords(suiteRecord, suiteName, records);

      if (records.length > 0) {
        const detail = recordsToResult(records);
        suites.push(...detail.suites);
        failures.push(...detail.failures);
        durationSec += detail.durationSec;
      } else {
        const aggregate = aggregateSuite(suiteRecord, suiteName);
        if (aggregate) {
          suites.push(aggregate);
          durationSec += asNonNegativeNumber(
            firstDefined(suiteRecord, ["duration", "time", "durationSec"])
          );
        }
      }
    });

    if (suites.length > 0) {
      const explicitFailures = topLevelFailures(container?.failures);
      return finalizeReport(
        suites,
        failures.length > 0 ? failures : explicitFailures,
        durationSec
      );
    }
  }

  if (container) {
    const records: TestRecord[] = [];
    for (const key of [
      "assertionResults",
      "testcases",
      "testCases",
      "tests",
      "specs",
      "results",
    ]) {
      if (Array.isArray(container[key])) {
        collectTestRecords(container[key], "Test report", records);
      }
    }
    if (records.length > 0) {
      const detail = recordsToResult(records);
      return finalizeReport(detail.suites, detail.failures, detail.durationSec);
    }

    const stats = asRecord(container.stats);
    const aggregate =
      aggregateSuite(container, "Test report") ??
      aggregateSuite(stats, "Test report");
    if (aggregate) {
      const statsDuration =
        stats && stats.duration !== undefined
          ? asNonNegativeNumber(stats.duration) / 1000
          : 0;
      return finalizeReport(
        [aggregate],
        topLevelFailures(container.failures),
        statsDuration ||
          asNonNegativeNumber(
            firstDefined(container, ["durationSec", "duration", "time"])
          )
      );
    }
  }

  throw new Error(
    "Expected JSON test results, suite counts, or a normalized report."
  );
}

export function parseJSONReport(text: string): ParsedReport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON.";
    throw new Error(`Malformed JSON: ${message}`);
  }
  return parseJsonValue(data);
}

function statusFromLabel(label: string): TestStatus | "error" | "total" | null {
  const normalized = label.toLowerCase().replace(/[_-]+/g, " ").trim();
  if (/^total(?: tests?)?$/.test(normalized)) return "total";
  if (/^(error|errors)$/.test(normalized)) return "error";
  return normalizeStatus(normalized);
}

interface SummaryCandidate {
  passed?: number;
  failed?: number;
  errors?: number;
  skipped?: number;
  total?: number;
  score: number;
}

function summaryCandidate(line: string): SummaryCandidate | null {
  const candidate: SummaryCandidate = { score: 0 };
  const seen = new Set<string>();

  for (const match of line.matchAll(
    /(\d+)\s+(passed|passing|failed|failing|failures?|errors?|skipped|pending|ignored|disabled|xfailed|xpassed|total(?:\s+tests?)?)/gi
  )) {
    const status = statusFromLabel(match[2]);
    if (!status) continue;
    const count = Number(match[1]);
    if (status === "total") candidate.total = count;
    else if (status === "error") candidate.errors = count;
    else candidate[status] = count;
    seen.add(status);
  }

  for (const match of line.matchAll(
    /(passed|passing|failed|failing|failures?|errors?|skipped|pending|ignored|disabled|xfailed|xpassed|total(?:\s+tests?)?)\s*[:=]\s*(\d+)/gi
  )) {
    const status = statusFromLabel(match[1]);
    if (!status) continue;
    const count = Number(match[2]);
    if (status === "total") candidate.total = count;
    else if (status === "error") candidate.errors = count;
    else candidate[status] = count;
    seen.add(status);
  }

  candidate.score =
    seen.size * 10 +
    (candidate.total !== undefined ? 5 : 0) +
    (/^\s*Tests\s*:/i.test(line) ? 100 : 0);
  return seen.size > 0 ? candidate : null;
}

function parseStatusLines(text: string): ParsedReport | null {
  const records: TestRecord[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const leading = trimmed.match(
      /^(?:\[\s*)?(PASS(?:ED)?|FAIL(?:ED)?|ERROR|SKIP(?:PED)?|PENDING)(?:\s*\])?[\s:|\-]+(.+)$/i
    );
    const trailing = trimmed.match(
      /^(.+?)[\s|:,-]+(PASS(?:ED)?|FAIL(?:ED)?|ERROR|SKIP(?:PED)?|PENDING)$/i
    );
    const match = leading ?? trailing;
    if (!match) continue;
    const statusLabel = leading ? match[1] : match[2];
    const name = leading ? match[2] : match[1];
    const status = normalizeStatus(statusLabel);
    if (!status) continue;
    records.push({
      suite: "Test report",
      name: boundedText(name, `Test ${records.length + 1}`, 200),
      status,
      message: status === "failed" ? "See report for details" : "",
      durationSec: 0,
    });
  }

  if (records.length === 0) return null;
  const result = recordsToResult(records);
  return finalizeReport(result.suites, result.failures, 0);
}

export function parseLogReport(text: string): ParsedReport {
  const surefire = text.match(
    /Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)/i
  );

  let total: number;
  let failed: number;
  let skipped: number;
  let passed: number;

  if (surefire) {
    total = Number(surefire[1]);
    failed = Number(surefire[2]) + Number(surefire[3]);
    skipped = Number(surefire[4]);
    passed = Math.max(total - failed - skipped, 0);
  } else {
    const candidates = text
      .split(/\r?\n/)
      .map(summaryCandidate)
      .filter((candidate): candidate is SummaryCandidate => Boolean(candidate))
      .sort((left, right) => right.score - left.score);
    const candidate = candidates[0];

    if (!candidate) {
      const lineReport = parseStatusLines(text);
      if (lineReport) return lineReport;
      throw new Error(
        "Could not recognize test results in this text. Include a pass/fail summary or rows with test names and statuses."
      );
    }

    failed = (candidate.failed ?? 0) + (candidate.errors ?? 0);
    skipped = candidate.skipped ?? 0;
    passed = candidate.passed ?? 0;
    total = candidate.total ?? passed + failed + skipped;
    if (candidate.passed === undefined) {
      passed = Math.max(total - failed - skipped, 0);
    }
    total = Math.max(total, passed + failed + skipped);
  }

  const failNames = [
    ...text.matchAll(
      /^(?:FAILED|FAIL|ERROR|\[\s*FAIL(?:ED)?\s*\])[\s:|\-]+(.+)$/gim
    ),
  ].map((match) => boundedText(match[1], "unnamed test", 200));
  const failures: ParsedFailure[] = failNames.slice(0, 500).map((name) => ({
    suite: "Test report",
    test: name,
    message: "See report for details",
    highImpact: isHighImpact(name),
  }));
  const durationMatch =
    text.match(/\b(?:duration|time|elapsed)\s*[:=]\s*([0-9:.]+\s*(?:ms|s|sec|m|min|h)?)/i) ??
    text.match(/\bin\s+([0-9.]+\s*(?:ms|s|sec|m|min|h))\b/i);
  const durationSec = durationMatch ? durationSeconds(durationMatch[1]) : 0;

  return finalizeReport(
    [{ name: "Test report", total, passed, failed, skipped }],
    failures,
    durationSec
  );
}

function looksLikeHtml(text: string): boolean {
  return /^(?:<!doctype\s+html\b|<html\b)/i.test(text) ||
    /<(?:table|body)\b/i.test(text);
}

function looksDelimited(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 5);
  if (lines.length < 2) return false;
  return lines.some((line) => /[,\t;|]/.test(line)) &&
    lines.some((line) => /\b(status|result|outcome|passed|failed|skipped)\b/i.test(line));
}

export function parseAnyReport(rawText: string): ParsedReport {
  const text = rawText.replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error("The report is empty.");

  if (looksLikeHtml(text)) return parseHTMLReport(text);
  if (text.startsWith("<")) return parseJUnitXML(text);
  if (text.startsWith("{") || text.startsWith("[")) return parseJSONReport(text);
  if (looksDelimited(text)) {
    try {
      return parseDelimitedReport(text);
    } catch {
      // A plain-text log can contain commas or pipes; let the log parser inspect it.
    }
  }
  return parseLogReport(text);
}
