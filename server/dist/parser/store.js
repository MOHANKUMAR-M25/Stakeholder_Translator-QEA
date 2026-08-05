import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "os";
import { parseReportInput } from "./dispatch.js";
const TEMP_DIR = path.join(os.tmpdir(), "stakeholder-translator-cache");
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}
const LATEST_REPORT_FILE = path.join(TEMP_DIR, "latest_report.json");
const HISTORY_FILE = path.join(TEMP_DIR, "history.json");
const MAX_HISTORY = 25;
function failingIdsOf(report) {
    return report.failures.map((f) => `${f.suite}::${f.test}`);
}
/** A cheap content fingerprint used to tell "the same report translated again" apart from "an actually new run". */
function signatureOf(e) {
    return `${e.totalTests}|${e.passed}|${e.failed}|${e.skipped}|${[...e.failingTests].sort().join(",")}`;
}
function readHistory() {
    if (!fs.existsSync(HISTORY_FILE))
        return [];
    try {
        return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
    }
    catch {
        return [];
    }
}
function writeHistory(entries) {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(entries.slice(-MAX_HISTORY)), "utf8");
}
function recordHistory(reportId, report) {
    const entry = {
        reportId,
        timestamp: new Date().toISOString(),
        totalTests: report.totalTests,
        passed: report.passed,
        failed: report.failed,
        skipped: report.skipped,
        passRatePct: report.passRatePct,
        rag: report.rag,
        ragLabel: report.ragLabel,
        failingTests: failingIdsOf(report),
    };
    const history = readHistory();
    const last = history[history.length - 1];
    // Don't record a duplicate entry if this is the same content as the last run (e.g. the user
    // just clicked through DM/PO/Client tabs for one upload) — that would pad the sparkline and
    // make every trend look like "no change" against itself instead of the real previous run.
    if (!last || signatureOf(last) !== signatureOf(entry)) {
        history.push(entry);
        writeHistory(history);
    }
    return entry;
}
export function getHistory() {
    return readHistory();
}
/** Compares a report against the most recent prior run (if any) already recorded in history. */
export function computeTrend(reportId, report) {
    const history = readHistory();
    const currentSig = signatureOf({
        totalTests: report.totalTests,
        passed: report.passed,
        failed: report.failed,
        skipped: report.skipped,
        failingTests: failingIdsOf(report),
    });
    // Walk backwards past any trailing entries that are just this same run recorded again,
    // to find the most recent genuinely different run.
    let previous;
    for (let i = history.length - 1; i >= 0; i--) {
        if (signatureOf(history[i]) !== currentSig) {
            previous = history[i];
            break;
        }
    }
    if (!previous) {
        return { hasPrevious: false, newlyFailing: [], newlyFixed: [], summary: "No previous run to compare against — this is the first recorded run." };
    }
    const currentFailing = new Set(failingIdsOf(report));
    const previousFailing = new Set(previous.failingTests);
    const newlyFailing = [...currentFailing].filter((id) => !previousFailing.has(id));
    const newlyFixed = [...previousFailing].filter((id) => !currentFailing.has(id));
    const passRateDeltaPct = Math.round((report.passRatePct - previous.passRatePct) * 10) / 10;
    const direction = passRateDeltaPct > 0 ? "up" : passRateDeltaPct < 0 ? "down" : "flat";
    const summary = `Pass rate ${direction} ${Math.abs(passRateDeltaPct)}pt vs previous run ` +
        `(${previous.passRatePct}% → ${report.passRatePct}%). ` +
        `${newlyFailing.length} newly failing, ${newlyFixed.length} newly fixed.`;
    return { hasPrevious: true, previous, passRateDeltaPct, newlyFailing, newlyFixed, summary };
}
export async function ingestReport(input) {
    // Back-compat: a plain string is treated as raw text content (old call sites / simple text formats).
    const payload = typeof input === "string" ? { text: input } : input;
    const report = await parseReportInput(payload);
    const reportId = randomUUID();
    // 1. Write the specific report ID file
    const reportPath = path.join(TEMP_DIR, `${reportId}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report), "utf8");
    // 2. Write to a static global fallback file that any process can read
    fs.writeFileSync(LATEST_REPORT_FILE, JSON.stringify(report), "utf8");
    // 3. Append to the rolling history used for trend/regression comparisons
    recordHistory(reportId, report);
    return { reportId, report };
}
export function getReport(reportId) {
    const reportPath = path.join(TEMP_DIR, `${reportId}.json`);
    if (fs.existsSync(reportPath)) {
        return JSON.parse(fs.readFileSync(reportPath, "utf8"));
    }
    if (fs.existsSync(LATEST_REPORT_FILE)) {
        return JSON.parse(fs.readFileSync(LATEST_REPORT_FILE, "utf8"));
    }
    throw new Error(`No report loaded for id "${reportId}".`);
}
export function dropReport(reportId) {
    const reportPath = path.join(TEMP_DIR, `${reportId}.json`);
    if (fs.existsSync(reportPath)) {
        fs.unlinkSync(reportPath);
    }
}
