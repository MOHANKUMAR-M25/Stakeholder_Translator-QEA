import * as path from "node:path";
import { fork } from "node:child_process";
import { toCanonicalReport } from "./model.js";
import { parseAnyReport, parseDelimitedReport, parseHTMLReport, parseJSONReport, parseTabularSources, } from "./xml.js";
import { parseJUnitXML } from "./junit.js";
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const BINARY_TIMEOUT_MS = 20_000;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
export const SUPPORTED_REPORT_EXTENSIONS = [
    ".pdf",
    ".xlsx",
    ".xls",
    ".html",
    ".xml",
    ".json",
    ".csv",
    ".txt",
];
function reportExtension(fileName) {
    const extension = path.extname(fileName).toLowerCase();
    if (!SUPPORTED_REPORT_EXTENSIONS.includes(extension)) {
        throw new Error(`Unsupported report type "${extension || "(none)"}". Expected PDF, Excel, HTML, XML, JSON, CSV, or TXT.`);
    }
    return extension;
}
function hasPrefix(bytes, prefix) {
    return prefix.every((byte, index) => bytes[index] === byte);
}
function validateBinarySignature(extension, bytes) {
    if (extension === ".pdf" && !hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
        throw new Error("The selected .pdf file does not have a valid PDF signature.");
    }
    if (extension === ".xlsx" &&
        !hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04])) {
        throw new Error("The selected .xlsx file is not a valid Excel Open XML workbook.");
    }
    if (extension === ".xls" &&
        !hasPrefix(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
        throw new Error("The selected .xls file is not a valid legacy Excel workbook.");
    }
}
function decodeText(bytes) {
    let encoding = "utf-8";
    let offset = 0;
    if (hasPrefix(bytes, [0xff, 0xfe])) {
        encoding = "utf-16le";
        offset = 2;
    }
    else if (hasPrefix(bytes, [0xfe, 0xff])) {
        encoding = "utf-16be";
        offset = 2;
    }
    else if (hasPrefix(bytes, [0xef, 0xbb, 0xbf])) {
        offset = 3;
    }
    try {
        return new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(offset));
    }
    catch {
        if (encoding !== "utf-8") {
            throw new Error(`The report could not be decoded as ${encoding.toUpperCase()} text.`);
        }
        return new TextDecoder("windows-1252").decode(bytes);
    }
}
function runBinaryParser(kind, bytes) {
    return new Promise((resolve, reject) => {
        const child = fork(new URL("./binary-file-child.js", import.meta.url), [], {
            execArgv: [
                ...process.execArgv.filter((argument) => !argument.startsWith("--input-type") &&
                    !argument.startsWith("--max-old-space-size")),
                `--max-old-space-size=${kind === "pdf" ? 256 : 128}`,
            ],
            serialization: "advanced",
            stdio: ["ignore", "ignore", "ignore", "ipc"],
            windowsHide: true,
        });
        let settled = false;
        const finish = (callback) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            callback();
        };
        const timer = setTimeout(() => {
            finish(() => {
                child.kill();
                reject(new Error(`${kind === "pdf" ? "PDF" : "Excel"} parsing exceeded the ${BINARY_TIMEOUT_MS / 1000}-second limit.`));
            });
        }, BINARY_TIMEOUT_MS);
        child.once("message", (message) => {
            finish(() => {
                if (message.ok)
                    resolve(message);
                else
                    reject(new Error(message.error || "Binary report parsing failed."));
            });
        });
        child.once("error", (error) => finish(() => reject(error)));
        child.once("exit", (code, signal) => {
            finish(() => reject(new Error(`Binary report parser stopped unexpectedly (${signal || code || "unknown"}).`)));
        });
        child.send({ kind, bytes }, (error) => {
            if (error)
                finish(() => reject(error));
        });
    });
}
function parseTextFile(extension, text) {
    switch (extension) {
        case ".html":
            return parseHTMLReport(text);
        case ".xml":
            return parseJUnitXML(text);
        case ".json":
            return parseJSONReport(text);
        case ".csv":
            return parseDelimitedReport(text);
        case ".txt":
            return parseAnyReport(text);
        default:
            throw new Error(`"${extension}" is not a text report format.`);
    }
}
async function parsePdf(bytes) {
    const extracted = await runBinaryParser("pdf", bytes);
    if (extracted.sources?.length) {
        try {
            return parseTabularSources(extracted.sources);
        }
        catch {
            // Fall through to visible PDF text when its tables are layout-only.
        }
    }
    const text = extracted.text?.trim() ?? "";
    if (!text) {
        throw new Error("The PDF contains no extractable text. Scanned/image-only PDFs require OCR and are not supported.");
    }
    return parseAnyReport(text);
}
async function parseSpreadsheet(bytes) {
    const extracted = await runBinaryParser("spreadsheet", bytes);
    if (!extracted.sources?.length) {
        throw new Error("The workbook does not contain readable worksheet data.");
    }
    return parseTabularSources(extracted.sources);
}
export async function parseReportBytes(fileName, bytes) {
    const extension = reportExtension(fileName);
    if (bytes.byteLength === 0)
        throw new Error("The report file is empty.");
    if (bytes.byteLength > MAX_FILE_BYTES) {
        throw new Error("The report file is larger than 5 MB.");
    }
    validateBinarySignature(extension, bytes);
    if (extension === ".pdf")
        return parsePdf(bytes);
    if (extension === ".xlsx" || extension === ".xls") {
        return parseSpreadsheet(bytes);
    }
    return parseTextFile(extension, decodeText(bytes));
}
export async function parseBase64ReportFile(fileName, contentBase64) {
    const normalized = contentBase64.replace(/\s+/g, "");
    if (!normalized ||
        normalized.length % 4 !== 0 ||
        !BASE64_PATTERN.test(normalized)) {
        throw new Error("The report file content is not valid base64.");
    }
    const bytes = Buffer.from(normalized, "base64");
    return parseReportBytes(fileName, bytes);
}
export function canonicalReportText(report) {
    return JSON.stringify(toCanonicalReport(report), null, 2);
}
