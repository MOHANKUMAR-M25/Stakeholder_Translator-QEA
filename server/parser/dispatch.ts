import { parseJUnitXML } from "./junit.js";
import type { ParsedReport } from "./junit.js";
import { parseJSONReport, parseLogReport } from "./xml.js";
import { parseCsvReport, parseXlsxReport } from "./tabular.js";
import { parseHtmlReport } from "./html.js";
import { parsePdfReport } from "./pdf.js";
import { SUPPORTED_FORMATS, BINARY_FORMATS, type SupportedFormat } from "./shared.js";

export interface ReportInput {
  /** Raw text content — used for xml/json/csv/html/txt/log. */
  text?: string;
  /** Base64-encoded content — required for binary formats (xlsx/xls/pdf), optional otherwise. */
  base64?: string;
  /** Original filename, used to infer format from its extension when `format` isn't given. */
  filename?: string;
  /** Explicit format override (with or without a leading dot), e.g. "csv" or ".csv". */
  format?: string;
}

function extOf(filename?: string): string | undefined {
  if (!filename) return undefined;
  const m = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m?.[1];
}

function isSupported(fmt: string): fmt is SupportedFormat {
  return (SUPPORTED_FORMATS as readonly string[]).includes(fmt);
}

function sniffTextFormat(text: string): SupportedFormat {
  const t = text.trim();
  if (t.startsWith("<")) {
    return /<html[\s>]|<!doctype html/i.test(t.slice(0, 300)) ? "html" : "xml";
  }
  if (t.startsWith("{") || t.startsWith("[")) return "json";

  // Crude CSV sniff: a comma-heavy first line that doesn't look like a plain-text log summary.
  const firstLine = t.split("\n")[0] || "";
  const commaCount = (firstLine.match(/,/g) || []).length;
  if (commaCount >= 2 && !/tests run|passed|failed/i.test(firstLine)) return "csv";

  return "txt";
}

export function resolveFormat(input: ReportInput): SupportedFormat {
  const explicit = (input.format || "").toLowerCase().replace(/^\./, "");
  if (explicit && isSupported(explicit)) return explicit;

  const fromFilename = extOf(input.filename);
  if (fromFilename && isSupported(fromFilename)) return fromFilename;

  if (input.text) return sniffTextFormat(input.text);

  throw new Error(
    "Couldn't determine the report format for this file. Please make sure it has a recognizable " +
      "extension (.xml, .json, .csv, .html, .txt, .xlsx, .xls, .pdf)."
  );
}

export async function parseReportInput(input: ReportInput): Promise<ParsedReport> {
  const format = resolveFormat(input);

  if (BINARY_FORMATS.has(format)) {
    if (!input.base64) {
      throw new Error(`".${format}" reports must be uploaded as a file — no binary content was received.`);
    }
    const buffer = Buffer.from(input.base64, "base64");
    if (format === "pdf") return parsePdfReport(buffer);
    return parseXlsxReport(buffer); // xlsx or xls
  }

  const text = input.text ?? "";
  if (!text.trim()) throw new Error("No report content provided.");

  switch (format) {
    case "xml":
      return parseJUnitXML(text);
    case "json":
      return parseJSONReport(text);
    case "csv":
      return parseCsvReport(text);
    case "html":
    case "htm":
      return parseHtmlReport(text);
    case "txt":
    case "log":
    default:
      return parseLogReport(text);
  }
}
