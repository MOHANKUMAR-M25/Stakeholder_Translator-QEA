import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "os";
import { parseAnyReport } from "./xml.js";
const TEMP_DIR = path.join(os.tmpdir(), "stakeholder-translator-cache");
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}
const LATEST_REPORT_FILE = path.join(TEMP_DIR, "latest_report.json");
export function ingestReport(rawText) {
    const report = parseAnyReport(rawText);
    const reportId = randomUUID();
    // 1. Write the specific report ID file
    const reportPath = path.join(TEMP_DIR, `${reportId}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report), "utf8");
    // 2. Write to a static global fallback file that any process can read
    fs.writeFileSync(LATEST_REPORT_FILE, JSON.stringify(report), "utf8");
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
