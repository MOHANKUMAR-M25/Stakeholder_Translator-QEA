import * as XLSX from "xlsx";
import type { ParsedFailure, ParsedReport, ParsedSuite } from "./junit.js";
import { isHighImpact, finalizeReport } from "./shared.js";

type Row = Record<string, unknown>;

const SUITE_KEYS = ["suite", "suitename", "module", "class", "classname", "feature", "component", "spec", "file"];
const TEST_KEYS = ["test", "testname", "name", "case", "testcase", "title", "scenario", "description"];
const STATUS_KEYS = ["status", "result", "outcome", "state", "pass/fail", "passfail"];
const MESSAGE_KEYS = ["message", "error", "errormessage", "reason", "details", "failure", "failuremessage"];
const DURATION_KEYS = ["duration", "time", "timesec", "durationsec", "elapsed", "elapsedtime"];

function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[\s_\-]+/g, "");
}

function pick(row: Row, keys: string[]): string | undefined {
  const normalized = new Map(Object.keys(row).map((k) => [normalizeKey(k), k]));
  for (const key of keys) {
    const actual = normalized.get(key);
    if (actual !== undefined && row[actual] !== undefined && row[actual] !== "") {
      return String(row[actual]);
    }
  }
  return undefined;
}


export function rowsToReport(rows: Row[]): ParsedReport {
  if (rows.length === 0) throw new Error("No data rows found in this file.");

  const testColumn = rows.some((r) => pick(r, TEST_KEYS) !== undefined);
  const statusColumn = rows.some((r) => pick(r, STATUS_KEYS) !== undefined);
  if (!testColumn || !statusColumn) {
    throw new Error(
      "Couldn't find recognizable test-name and status columns. Expected headers like " +
        "Suite/Test/Status/Message (status values containing pass/fail/skip)."
    );
  }

  const suiteMap = new Map<string, ParsedSuite>();
  const failures: ParsedFailure[] = [];
  let durationSec = 0;

  for (const row of rows) {
    const suiteName = pick(row, SUITE_KEYS) || "Suite";
    const testName = pick(row, TEST_KEYS) || "unnamed test";
    const statusRaw = (pick(row, STATUS_KEYS) || "").toLowerCase();
    const message = pick(row, MESSAGE_KEYS) || "Failed";
    const duration = parseFloat(pick(row, DURATION_KEYS) || "0");
    if (!isNaN(duration)) durationSec += duration;

    if (!suiteMap.has(suiteName)) {
      suiteMap.set(suiteName, { name: suiteName, total: 0, passed: 0, failed: 0, skipped: 0 });
    }
    const suite = suiteMap.get(suiteName)!;
    suite.total++;

    if (statusRaw.includes("pass") || statusRaw === "ok" || statusRaw === "success") {
      suite.passed++;
    } else if (statusRaw.includes("fail") || statusRaw.includes("error")) {
      suite.failed++;
      failures.push({
        suite: suiteName,
        test: testName,
        message: message.slice(0, 300),
        highImpact: isHighImpact(`${suiteName} ${testName} ${message}`),
      });
    } else if (statusRaw.includes("skip") || statusRaw.includes("pending")) {
      suite.skipped++;
    } else {
      suite.skipped++;
    }
  }

  return finalizeReport([...suiteMap.values()], failures, durationSec);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell !== "")) rows.push(row);
  }
  return rows;
}

export function parseCsvReport(text: string): ParsedReport {
  const grid = parseCsv(text);
  if (grid.length < 2) throw new Error("CSV needs a header row plus at least one data row.");

  const [header, ...dataRows] = grid;
  const rows: Row[] = dataRows.map((cells) => {
    const row: Row = {};
    header.forEach((h, i) => (row[h] = cells[i] ?? ""));
    return row;
  });

  return rowsToReport(rows);
}

export function parseXlsxReport(buffer: Buffer): ParsedReport {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch (err) {
    throw new Error("Couldn't read this as an Excel file — is it a valid .xlsx/.xls?");
  }


  const preferredNames = ["results", "tests", "test results", "testresults", "summary"];
  const sheetName =
    workbook.SheetNames.find((n) => preferredNames.includes(n.trim().toLowerCase())) || workbook.SheetNames[0];
  if (!sheetName) throw new Error("This workbook has no sheets.");

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Row>(sheet, { defval: "", raw: false });

  return rowsToReport(rows);
}
