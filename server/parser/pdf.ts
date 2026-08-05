import { PDFParse } from "pdf-parse";
import type { ParsedReport } from "./junit.js";
import { rowsToReport } from "./tabular.js";
import { parseLogReport } from "./xml.js";

const HEADER_HINTS = ["suite", "test", "status", "result", "name", "case", "outcome", "message"];


function extractPdfTableRows(text: string): Record<string, string>[] | null {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const splitCols = (line: string) => line.split(/\s{2,}|\t+/).map((c) => c.trim()).filter(Boolean);

  const headerIndex = lines.findIndex((line) => {
    const lower = line.toLowerCase();
    return HEADER_HINTS.filter((h) => lower.includes(h)).length >= 2 && splitCols(line).length >= 2;
  });
  if (headerIndex === -1) return null;

  const header = splitCols(lines[headerIndex]);
  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const cols = splitCols(line);
    if (cols.length < 2) continue;
    const row: Record<string, string> = {};
    header.forEach((h, i) => (row[h] = cols[i] ?? ""));
    rows.push(row);
  }
  return rows.length > 0 ? rows : null;
}

export async function parsePdfReport(buffer: Buffer): Promise<ParsedReport> {
  const parser = new PDFParse({ data: buffer });
  let text: string;
  try {
    const result = await parser.getText();
    text = result.text || "";
  } catch (err) {
    throw new Error("Couldn't read this PDF — it may be scanned/image-only or password-protected.");
  } finally {
    await parser.destroy().catch(() => {});
  }

  if (!text.trim()) {
    throw new Error("No extractable text in this PDF (it may be a scanned image without OCR text).");
  }

  const tableRows = extractPdfTableRows(text);
  if (tableRows) {
    try {
      return rowsToReport(tableRows);
    } catch {
      // Table-looking text didn't actually map to test rows — fall through to the summary heuristic.
    }
  }

  return parseLogReport(text);
}
