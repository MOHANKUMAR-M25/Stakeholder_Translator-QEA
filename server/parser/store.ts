import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "os";
import { parseReportInput, type ReportInput } from "./dispatch.js";
import type { ParsedReport } from "./junit.js";


const TEMP_DIR = path.join(os.tmpdir(), "stakeholder-translator-cache");
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

const LATEST_REPORT_FILE = path.join(TEMP_DIR, "latest_report.json");
const HISTORY_FILE = path.join(TEMP_DIR, "history.json");
const MAX_HISTORY = 25;

export interface HistoryEntry {
  reportId: string;
  timestamp: string;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  passRatePct: number;
  rag: "green" | "amber" | "red";
  ragLabel: string;
  failingTests: string[];
}

export interface TrendResult {
  hasPrevious: boolean;
  previous?: HistoryEntry;
  passRateDeltaPct?: number;
  newlyFailing: string[];
  newlyFixed: string[];
  summary: string;
}

function failingIdsOf(report: ParsedReport): string[] {
  return report.failures.map((f: any) => `${f.suite}::${f.test}`);
}


function signatureOf(e: { totalTests: number; passed: number; failed: number; skipped: number; failingTests: string[] }): string {
  return `${e.totalTests}|${e.passed}|${e.failed}|${e.skipped}|${[...e.failingTests].sort().join(",")}`;
}

function readHistory(): HistoryEntry[] {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
  } catch {
    return [];
  }
}

function writeHistory(entries: HistoryEntry[]): void {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(entries.slice(-MAX_HISTORY)), "utf8");
}

function recordHistory(reportId: string, report: ParsedReport): HistoryEntry {
  const entry: HistoryEntry = {
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
  if (!last || signatureOf(last) !== signatureOf(entry)) {
    history.push(entry);
    writeHistory(history);
  }
  return entry;
}

export function getHistory(): HistoryEntry[] {
  return readHistory();
}


export function computeTrend(reportId: string, report: ParsedReport): TrendResult {
  const history = readHistory();
  const currentSig = signatureOf({
    totalTests: report.totalTests,
    passed: report.passed,
    failed: report.failed,
    skipped: report.skipped,
    failingTests: failingIdsOf(report),
  });


  let previous: HistoryEntry | undefined;
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
  const summary =
    `Pass rate ${direction} ${Math.abs(passRateDeltaPct)}pt vs previous run ` +
    `(${previous.passRatePct}% → ${report.passRatePct}%). ` +
    `${newlyFailing.length} newly failing, ${newlyFixed.length} newly fixed.`;

  return { hasPrevious: true, previous, passRateDeltaPct, newlyFailing, newlyFixed, summary };
}

export async function ingestReport(input: ReportInput | string) {
    
    const payload: ReportInput = typeof input === "string" ? { text: input } : input;
    const report = await parseReportInput(payload);
    const reportId = randomUUID();
    
   
    const reportPath = path.join(TEMP_DIR, `${reportId}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report), "utf8");
    
    fs.writeFileSync(LATEST_REPORT_FILE, JSON.stringify(report), "utf8");

    recordHistory(reportId, report);
    
    return { reportId, report };
}

export function getReport(reportId: string) {
    const reportPath = path.join(TEMP_DIR, `${reportId}.json`);
    
    if (fs.existsSync(reportPath)) {
        return JSON.parse(fs.readFileSync(reportPath, "utf8"));
    }
    
    if (fs.existsSync(LATEST_REPORT_FILE)) {
        return JSON.parse(fs.readFileSync(LATEST_REPORT_FILE, "utf8"));
    }
    
    throw new Error(`No report loaded for id "${reportId}".`);
}

export function dropReport(reportId: string) {
    const reportPath = path.join(TEMP_DIR, `${reportId}.json`);
    if (fs.existsSync(reportPath)) {
        fs.unlinkSync(reportPath);
    }
}