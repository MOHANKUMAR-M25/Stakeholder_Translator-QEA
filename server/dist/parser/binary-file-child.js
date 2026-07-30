const MAX_SHEETS = 25;
const MAX_ROWS_PER_SHEET = 10_000;
const MAX_COLUMNS = 100;
const MAX_CELLS = 200_000;
const MAX_PDF_PAGES = 250;
const MAX_EXTRACTED_TEXT = 2 * 1024 * 1024;
function safeError(error) {
    return error instanceof Error ? error.message : "Binary report parsing failed.";
}
async function parseSpreadsheet(bytes) {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(Buffer.from(bytes), {
        type: "buffer",
        dense: true,
        cellFormula: false,
        cellHTML: false,
        cellNF: false,
        bookDeps: false,
        bookFiles: false,
        sheetRows: MAX_ROWS_PER_SHEET + 1,
    });
    if (workbook.SheetNames.length === 0) {
        throw new Error("The workbook does not contain any worksheets.");
    }
    if (workbook.SheetNames.length > MAX_SHEETS) {
        throw new Error(`The workbook exceeds the ${MAX_SHEETS} worksheet limit.`);
    }
    let cellCount = 0;
    const sources = workbook.SheetNames.map((name) => {
        const worksheet = workbook.Sheets[name];
        if (worksheet["!ref"]) {
            const range = XLSX.utils.decode_range(worksheet["!ref"]);
            if (range.e.r - range.s.r + 1 > MAX_ROWS_PER_SHEET) {
                throw new Error(`The worksheet "${name}" exceeds the ${MAX_ROWS_PER_SHEET} row limit.`);
            }
            if (range.e.c - range.s.c + 1 > MAX_COLUMNS) {
                throw new Error(`The worksheet "${name}" exceeds the ${MAX_COLUMNS} column limit.`);
            }
        }
        const rows = XLSX.utils.sheet_to_json(worksheet, {
            header: 1,
            raw: false,
            rawNumbers: false,
            defval: "",
            blankrows: false,
            skipHidden: true,
        });
        if (rows.length > MAX_ROWS_PER_SHEET) {
            throw new Error(`The worksheet "${name}" exceeds the ${MAX_ROWS_PER_SHEET} row limit.`);
        }
        for (const row of rows) {
            if (row.length > MAX_COLUMNS) {
                throw new Error(`The worksheet "${name}" exceeds the ${MAX_COLUMNS} column limit.`);
            }
            cellCount += row.length;
            if (cellCount > MAX_CELLS) {
                throw new Error(`The workbook exceeds the ${MAX_CELLS.toLocaleString()} cell limit.`);
            }
        }
        return { name, rows };
    });
    return { sources };
}
async function parsePdf(bytes) {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: bytes });
    try {
        const textResult = await parser.getText();
        if (textResult.total > MAX_PDF_PAGES) {
            throw new Error(`The PDF exceeds the ${MAX_PDF_PAGES} page limit.`);
        }
        if (textResult.text.length > MAX_EXTRACTED_TEXT) {
            throw new Error("The PDF contains too much extracted text.");
        }
        let sources = [];
        try {
            const tableResult = await parser.getTable();
            sources = tableResult.pages.flatMap((page) => page.tables.map((rows, index) => ({
                name: `PDF page ${page.num}, table ${index + 1}`,
                rows,
            })));
        }
        catch {
            // Text summaries are still useful when a PDF table cannot be reconstructed.
        }
        return { text: textResult.text, sources };
    }
    finally {
        await parser.destroy();
    }
}
function reply(message) {
    if (!process.send) {
        process.exitCode = 1;
        return;
    }
    process.send(message, () => process.exit(0));
}
async function main(input) {
    try {
        const result = input.kind === "pdf"
            ? await parsePdf(input.bytes)
            : await parseSpreadsheet(input.bytes);
        reply({ ok: true, ...result });
    }
    catch (error) {
        reply({ ok: false, error: safeError(error) });
    }
}
process.once("message", (message) => {
    void main(message);
});
export {};
