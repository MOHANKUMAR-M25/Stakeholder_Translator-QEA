import * as XLSX from "xlsx";
import { isHighImpact, finalizeReport } from "./shared.js";
const SUITE_KEYS = ["suite", "suitename", "module", "class", "classname", "feature", "component", "spec", "file"];
const TEST_KEYS = ["test", "testname", "name", "case", "testcase", "title", "scenario", "description"];
const STATUS_KEYS = ["status", "result", "outcome", "state", "pass/fail", "passfail"];
const MESSAGE_KEYS = ["message", "error", "errormessage", "reason", "details", "failure", "failuremessage"];
const DURATION_KEYS = ["duration", "time", "timesec", "durationsec", "elapsed", "elapsedtime"];
function normalizeKey(k) {
    return k.toLowerCase().replace(/[\s_\-]+/g, "");
}
function pick(row, keys) {
    const normalized = new Map(Object.keys(row).map((k) => [normalizeKey(k), k]));
    for (const key of keys) {
        const actual = normalized.get(key);
        if (actual !== undefined && row[actual] !== undefined && row[actual] !== "") {
            return String(row[actual]);
        }
    }
    return undefined;
}
/**
 * Turns generic tabular rows (from CSV or a spreadsheet) into a ParsedReport. Column names are
 * matched loosely (case/spacing-insensitive) against common conventions — suite/module/class,
 * test/name/case, status/result/outcome, message/error, duration/time — so this works for most
 * hand-exported or CI-generated test-result spreadsheets without a fixed schema.
 */
export function rowsToReport(rows) {
    if (rows.length === 0)
        throw new Error("No data rows found in this file.");
    const testColumn = rows.some((r) => pick(r, TEST_KEYS) !== undefined);
    const statusColumn = rows.some((r) => pick(r, STATUS_KEYS) !== undefined);
    if (!testColumn || !statusColumn) {
        throw new Error("Couldn't find recognizable test-name and status columns. Expected headers like " +
            "Suite/Test/Status/Message (status values containing pass/fail/skip).");
    }
    const suiteMap = new Map();
    const failures = [];
    let durationSec = 0;
    for (const row of rows) {
        const suiteName = pick(row, SUITE_KEYS) || "Suite";
        const testName = pick(row, TEST_KEYS) || "unnamed test";
        const statusRaw = (pick(row, STATUS_KEYS) || "").toLowerCase();
        const message = pick(row, MESSAGE_KEYS) || "Failed";
        const duration = parseFloat(pick(row, DURATION_KEYS) || "0");
        if (!isNaN(duration))
            durationSec += duration;
        if (!suiteMap.has(suiteName)) {
            suiteMap.set(suiteName, { name: suiteName, total: 0, passed: 0, failed: 0, skipped: 0 });
        }
        const suite = suiteMap.get(suiteName);
        suite.total++;
        if (statusRaw.includes("pass") || statusRaw === "ok" || statusRaw === "success") {
            suite.passed++;
        }
        else if (statusRaw.includes("fail") || statusRaw.includes("error")) {
            suite.failed++;
            failures.push({
                suite: suiteName,
                test: testName,
                message: message.slice(0, 300),
                highImpact: isHighImpact(`${suiteName} ${testName} ${message}`),
            });
        }
        else if (statusRaw.includes("skip") || statusRaw.includes("pending")) {
            suite.skipped++;
        }
        else {
            // Unrecognized status string — count it, but don't guess pass/fail; treat as skipped
            // rather than silently dropping the row so totals still reconcile.
            suite.skipped++;
        }
    }
    return finalizeReport([...suiteMap.values()], failures, durationSec);
}
/** Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped quotes, and commas/newlines inside quotes. */
function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i++;
                }
                else {
                    inQuotes = false;
                }
            }
            else {
                field += c;
            }
        }
        else if (c === '"') {
            inQuotes = true;
        }
        else if (c === ",") {
            row.push(field);
            field = "";
        }
        else if (c === "\n" || c === "\r") {
            if (c === "\r" && text[i + 1] === "\n")
                i++;
            row.push(field);
            field = "";
            if (row.some((cell) => cell !== ""))
                rows.push(row);
            row = [];
        }
        else {
            field += c;
        }
    }
    if (field !== "" || row.length > 0) {
        row.push(field);
        if (row.some((cell) => cell !== ""))
            rows.push(row);
    }
    return rows;
}
export function parseCsvReport(text) {
    const grid = parseCsv(text);
    if (grid.length < 2)
        throw new Error("CSV needs a header row plus at least one data row.");
    const [header, ...dataRows] = grid;
    const rows = dataRows.map((cells) => {
        const row = {};
        header.forEach((h, i) => (row[h] = cells[i] ?? ""));
        return row;
    });
    return rowsToReport(rows);
}
export function parseXlsxReport(buffer) {
    let workbook;
    try {
        workbook = XLSX.read(buffer, { type: "buffer" });
    }
    catch (err) {
        throw new Error("Couldn't read this as an Excel file — is it a valid .xlsx/.xls?");
    }
    // Prefer a sheet that looks like test results if there are several; otherwise take the first.
    const preferredNames = ["results", "tests", "test results", "testresults", "summary"];
    const sheetName = workbook.SheetNames.find((n) => preferredNames.includes(n.trim().toLowerCase())) || workbook.SheetNames[0];
    if (!sheetName)
        throw new Error("This workbook has no sheets.");
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
    return rowsToReport(rows);
}
