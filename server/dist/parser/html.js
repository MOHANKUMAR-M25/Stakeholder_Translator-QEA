import * as cheerio from "cheerio";
import { rowsToReport } from "./tabular.js";
import { parseLogReport } from "./xml.js";
/**
 * Generic <table> extractor: treats the first row (thead or first tr) as headers, and every
 * subsequent row as a data row keyed by those headers. Works for most CI-generated or manually
 * exported HTML test reports without assuming a specific reporter's markup.
 */
function extractTableRows($) {
    let best = [];
    $("table").each((_, table) => {
        const $table = $(table);
        const trs = $table.find("tr").toArray();
        if (trs.length < 2)
            return;
        const headerCells = $(trs[0])
            .find("th, td")
            .toArray()
            .map((c) => $(c).text().trim());
        if (headerCells.length === 0)
            return;
        const rows = [];
        for (const tr of trs.slice(1)) {
            const cells = $(tr)
                .find("td, th")
                .toArray()
                .map((c) => $(c).text().trim());
            if (cells.length === 0)
                continue;
            const row = {};
            headerCells.forEach((h, i) => (row[h || `col${i}`] = cells[i] ?? ""));
            rows.push(row);
        }
        if (rows.length > best.length)
            best = rows;
    });
    return best;
}
export function parseHtmlReport(html) {
    const $ = cheerio.load(html);
    const tableRows = extractTableRows($);
    if (tableRows.length > 0) {
        try {
            return rowsToReport(tableRows);
        }
        catch {
            // Fall through to the text-heuristic path below — the table(s) we found didn't look like
            // test results (e.g. a nav table), so try treating the whole page as free text instead.
        }
    }
    // No usable table — strip tags and reuse the same pass/fail-summary heuristics as plain-text
    // CI logs (handles reports that embed a "Tests run: X, Failures: Y" or pytest-style summary
    // line in a <div>/<pre>/<span> rather than a table).
    const text = $("body").length ? $("body").text() : $.text();
    return parseLogReport(text);
}
