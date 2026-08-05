import { PDFParse } from "pdf-parse";
import { rowsToReport } from "./tabular.js";
import { parseLogReport } from "./xml.js";
const HEADER_HINTS = ["suite", "test", "status", "result", "name", "case", "outcome", "message"];
/**
 * Many PDF test-report exports lay results out as a whitespace-aligned table (no real HTML/CSV
 * structure survives PDF text extraction). This looks for a header-like line, then splits it and
 * the rows beneath it on runs of 2+ spaces or tabs — a decent approximation of column boundaries
 * for monospaced or table-exported PDF text.
 */
function extractPdfTableRows(text) {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const splitCols = (line) => line.split(/\s{2,}|\t+/).map((c) => c.trim()).filter(Boolean);
    const headerIndex = lines.findIndex((line) => {
        const lower = line.toLowerCase();
        return HEADER_HINTS.filter((h) => lower.includes(h)).length >= 2 && splitCols(line).length >= 2;
    });
    if (headerIndex === -1)
        return null;
    const header = splitCols(lines[headerIndex]);
    const rows = [];
    for (const line of lines.slice(headerIndex + 1)) {
        const cols = splitCols(line);
        if (cols.length < 2)
            continue;
        const row = {};
        header.forEach((h, i) => (row[h] = cols[i] ?? ""));
        rows.push(row);
    }
    return rows.length > 0 ? rows : null;
}
export async function parsePdfReport(buffer) {
    const parser = new PDFParse({ data: buffer });
    let text;
    try {
        const result = await parser.getText();
        text = result.text || "";
    }
    catch (err) {
        throw new Error("Couldn't read this PDF — it may be scanned/image-only or password-protected.");
    }
    finally {
        await parser.destroy().catch(() => { });
    }
    if (!text.trim()) {
        throw new Error("No extractable text in this PDF (it may be a scanned image without OCR text).");
    }
    const tableRows = extractPdfTableRows(text);
    if (tableRows) {
        try {
            return rowsToReport(tableRows);
        }
        catch {
            // Table-looking text didn't actually map to test rows — fall through to the summary heuristic.
        }
    }
    return parseLogReport(text);
}
