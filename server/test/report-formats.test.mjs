import assert from "node:assert/strict";
import test from "node:test";

import * as XLSX from "xlsx";

import { parseReportBytes } from "../dist/parser/files.js";

const REPORT_ROWS = [
  ["Suite", "Test", "Status", "Duration", "Message"],
  ["Auth", "login", "passed", 1, ""],
  ["Auth", "payment checkout", "failed", 2, "Timeout"],
  ["Auth", "profile", "skipped", 3, ""],
];

const CSV_REPORT = [
  "Suite,Test,Status,Duration,Message",
  "Auth,login,passed,1,",
  "Auth,payment checkout,failed,2,Timeout",
  "Auth,profile,skipped,3,",
].join("\n");

const EXPECTED_REPORT = {
  totalTests: 3,
  passed: 1,
  failed: 1,
  skipped: 1,
  passRatePct: 33.3,
  durationSec: 6,
  suites: [
    {
      name: "Auth",
      total: 3,
      passed: 1,
      failed: 1,
      skipped: 1,
    },
  ],
  failures: [
    {
      suite: "Auth",
      test: "payment checkout",
      message: "Timeout",
      highImpact: true,
    },
  ],
  rag: "red",
  ragLabel: "High risk",
};

const encoder = new TextEncoder();

function textBytes(text) {
  return encoder.encode(text);
}

function escapePdfText(text) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

/**
 * Builds a small, standards-compliant PDF 1.4 document with one page and
 * selectable text. Offsets in its cross-reference table are computed from the
 * final byte representation, so this exercises the real PDF parser rather
 * than passing text with a renamed extension.
 */
function makePdf(lines) {
  const operations = ["BT", "/F1 10 Tf", "50 760 Td"];
  lines.forEach((line, index) => {
    if (index > 0) operations.push("0 -18 Td");
    operations.push(`(${escapePdfText(line)}) Tj`);
  });
  operations.push("ET");

  const stream = operations.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    [
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]",
      "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    ].join(" "),
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let document = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets[index + 1] = Buffer.byteLength(document, "latin1");
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(document, "latin1");
  document += `xref\n0 ${objects.length + 1}\n`;
  document += "0000000000 65535 f \n";
  for (let index = 1; index <= objects.length; index += 1) {
    document += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  document += [
    "trailer",
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    "startxref",
    String(xrefOffset),
    "%%EOF",
    "",
  ].join("\n");

  return Buffer.from(document, "latin1");
}

function makeWorkbook(bookType) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(REPORT_ROWS);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Results");
  return new Uint8Array(
    XLSX.write(workbook, {
      type: "buffer",
      bookType,
    })
  );
}

const XML_REPORT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="Auth" tests="3" failures="1" errors="0" skipped="1" time="6">
    <testcase name="login" time="1"/>
    <testcase name="payment checkout" time="2">
      <failure message="Timeout"/>
    </testcase>
    <testcase name="profile" time="3">
      <skipped/>
    </testcase>
  </testsuite>
</testsuites>`;

const JSON_REPORT = JSON.stringify({
  suites: [
    {
      name: "Auth",
      tests: 3,
      passed: 1,
      failed: 1,
      skipped: 1,
      duration: 6,
    },
  ],
  failures: [
    {
      suite: "Auth",
      test: "payment checkout",
      message: "Timeout",
    },
  ],
});

const HTML_REPORT = `<!doctype html>
<html>
  <body>
    <table>
      <thead>
        <tr>
          <th>Suite</th><th>Test</th><th>Status</th><th>Duration</th><th>Message</th>
        </tr>
      </thead>
      <tbody>
        <tr><td>Auth</td><td>login</td><td>passed</td><td>1</td><td></td></tr>
        <tr><td>Auth</td><td>payment checkout</td><td>failed</td><td>2</td><td>Timeout</td></tr>
        <tr><td>Auth</td><td>profile</td><td>skipped</td><td>3</td><td></td></tr>
      </tbody>
    </table>
  </body>
</html>`;

const formatCases = [
  {
    label: "PDF",
    fileName: "report.pdf",
    makeBytes: () => makePdf(CSV_REPORT.split("\n")),
  },
  {
    label: "Excel Open XML",
    fileName: "report.xlsx",
    makeBytes: () => makeWorkbook("xlsx"),
  },
  {
    label: "legacy Excel",
    fileName: "report.xls",
    makeBytes: () => makeWorkbook("biff8"),
  },
  {
    label: "HTML",
    fileName: "report.html",
    makeBytes: () => textBytes(HTML_REPORT),
  },
  {
    label: "XML",
    fileName: "report.xml",
    makeBytes: () => textBytes(XML_REPORT),
  },
  {
    label: "JSON",
    fileName: "report.json",
    makeBytes: () => textBytes(JSON_REPORT),
  },
  {
    label: "CSV",
    fileName: "report.csv",
    makeBytes: () => textBytes(CSV_REPORT),
  },
  {
    label: "plain text",
    fileName: "report.txt",
    makeBytes: () => textBytes(CSV_REPORT),
  },
];

for (const formatCase of formatCases) {
  test(`parses a genuine ${formatCase.label} report`, async () => {
    const bytes = formatCase.makeBytes();
    const result = await parseReportBytes(formatCase.fileName, bytes);
    assert.deepEqual(result, EXPECTED_REPORT);
  });
}

test("preserves aggregate JSON counts instead of treating them as zero", async () => {
  const result = await parseReportBytes(
    "aggregate.json",
    textBytes(
      JSON.stringify({
        suites: [
          {
            name: "Checkout",
            tests: "4",
            passed: "2",
            failed: "1",
            skipped: "1",
          },
        ],
      })
    )
  );

  assert.deepEqual(
    {
      totalTests: result.totalTests,
      passed: result.passed,
      failed: result.failed,
      skipped: result.skipped,
      passRatePct: result.passRatePct,
    },
    {
      totalTests: 4,
      passed: 2,
      failed: 1,
      skipped: 1,
      passRatePct: 50,
    }
  );
});

test("counts reordered pytest summary fields without dropping failures", async () => {
  const result = await parseReportBytes(
    "pytest.txt",
    textBytes("1 failed, 3 passed, 2 skipped in 1.2s")
  );

  assert.deepEqual(
    {
      totalTests: result.totalTests,
      passed: result.passed,
      failed: result.failed,
      skipped: result.skipped,
    },
    {
      totalTests: 6,
      passed: 3,
      failed: 1,
      skipped: 2,
    }
  );
});

test("uses Jest assertion results instead of the suite-level status", async () => {
  const result = await parseReportBytes(
    "jest.json",
    textBytes(
      JSON.stringify({
        testResults: [
          {
            testFilePath: "auth.spec.js",
            status: "failed",
            assertionResults: [
              { title: "login", status: "passed" },
              {
                title: "payment checkout",
                status: "failed",
                failureMessages: ["Timeout"],
              },
            ],
          },
        ],
      })
    )
  );

  assert.deepEqual(
    {
      totalTests: result.totalTests,
      passed: result.passed,
      failed: result.failed,
      failureTest: result.failures[0]?.test,
    },
    {
      totalTests: 2,
      passed: 1,
      failed: 1,
      failureTest: "payment checkout",
    }
  );
});

test("uses schema-aware JSON duration units", async () => {
  const generic = await parseReportBytes(
    "generic.json",
    textBytes(
      JSON.stringify({
        suites: [
          {
            name: "Auth",
            results: [
              { name: "login", status: "passed", duration: 2 },
              { name: "checkout", status: "failed", duration: 3 },
            ],
          },
        ],
      })
    )
  );
  assert.equal(generic.durationSec, 5);

  const jest = await parseReportBytes(
    "jest-duration.json",
    textBytes(
      JSON.stringify({
        testResults: [
          {
            testFilePath: "auth.spec.js",
            assertionResults: [
              { title: "login", status: "passed", duration: 1500 },
            ],
          },
        ],
      })
    )
  );
  assert.equal(jest.durationSec, 2);
});

test("collapses Playwright retry attempts under the parent spec title", async () => {
  const result = await parseReportBytes(
    "playwright.json",
    textBytes(
      JSON.stringify({
        suites: [
          {
            title: "Checkout",
            specs: [
              {
                title: "login retry",
                tests: [
                  {
                    status: "flaky",
                    results: [
                      { status: "failed", duration: 100 },
                      { status: "passed", duration: 80 },
                    ],
                  },
                ],
              },
              {
                title: "payment checkout",
                tests: [
                  {
                    status: "unexpected",
                    results: [
                      {
                        status: "timedOut",
                        duration: 1200,
                        error: { message: "Timeout" },
                      },
                    ],
                  },
                ],
              },
              {
                title: "known defect",
                tests: [
                  {
                    expectedStatus: "failed",
                    status: "expected",
                    results: [
                      {
                        status: "failed",
                        duration: 1500,
                        error: { message: "Known defect" },
                      },
                    ],
                  },
                ],
              },
              {
                title: "unexpected pass",
                tests: [
                  {
                    expectedStatus: "failed",
                    status: "unexpected",
                    results: [{ status: "passed", duration: 200 }],
                  },
                ],
              },
            ],
          },
        ],
      })
    )
  );

  assert.equal(result.totalTests, 4);
  assert.equal(result.passed, 2);
  assert.equal(result.failed, 2);
  assert.equal(result.durationSec, 3);
  assert.equal(result.failures[0]?.test, "payment checkout");
  assert.equal(result.failures[0]?.message, "Timeout");
  assert.equal(result.failures[1]?.test, "unexpected pass");
});

test("parses Mocha stats and nested failure errors", async () => {
  const result = await parseReportBytes(
    "mocha.json",
    textBytes(
      JSON.stringify({
        stats: {
          tests: 2,
          passes: 1,
          failures: 1,
          pending: 0,
          duration: 30,
        },
        tests: [
          { title: "login", duration: 10 },
          { title: "payment checkout", duration: 20 },
        ],
        passes: [{ title: "login", duration: 10 }],
        failures: [
          {
            title: "payment checkout",
            fullTitle: "Auth payment checkout",
            err: { message: "Timeout" },
          },
        ],
      })
    )
  );

  assert.equal(result.totalTests, 2);
  assert.equal(result.passed, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.failures[0]?.test, "payment checkout");
  assert.equal(result.failures[0]?.message, "Timeout");
});

test("prefers Jest test counts over test-suite counts in text", async () => {
  const result = await parseReportBytes(
    "jest.txt",
    textBytes(
      [
        "Test Suites: 1 failed, 2 passed, 3 total",
        "Tests:       5 failed, 10 passed, 15 total",
      ].join("\n")
    )
  );

  assert.equal(result.totalTests, 15);
  assert.equal(result.passed, 10);
  assert.equal(result.failed, 5);
});

test("uses aggregate table counts and detailed failure rows together", async () => {
  const result = await parseReportBytes(
    "summary-and-failures.html",
    textBytes(`
      <html><body>
        <table>
          <tr><th>Suite</th><th>Total</th><th>Passed</th><th>Failed</th><th>Skipped</th></tr>
          <tr><td>Auth</td><td>100</td><td>98</td><td>2</td><td>0</td></tr>
        </table>
        <table>
          <tr><th>Suite</th><th>Test</th><th>Status</th><th>Message</th></tr>
          <tr><td>Auth</td><td>payment checkout</td><td>failed</td><td>Timeout</td></tr>
          <tr><td>Auth</td><td>login lockout</td><td>failed</td><td>Wrong response</td></tr>
        </table>
      </body></html>
    `)
  );

  assert.equal(result.totalTests, 100);
  assert.equal(result.passed, 98);
  assert.equal(result.failed, 2);
  assert.equal(result.failures.length, 2);
  assert.equal(result.rag, "red");
});

test("decodes UTF-16 uploaded text reports", async () => {
  const utf16Json = Buffer.from(
    `\uFEFF${JSON.stringify({
      suites: [{ name: "Auth", tests: 2, passed: 1, failed: 1 }],
    })}`,
    "utf16le"
  );
  const result = await parseReportBytes("utf16.json", utf16Json);
  assert.equal(result.totalTests, 2);
  assert.equal(result.failed, 1);
});

test("rejects malformed XML instead of accepting a partial report", async () => {
  await assert.rejects(
    parseReportBytes(
      "malformed.xml",
      textBytes('<testsuite name="Auth" tests="1"><testcase></testsuite>')
    ),
    /malformed xml/i
  );
});

test("rejects an unterminated quoted CSV field", async () => {
  await assert.rejects(
    parseReportBytes(
      "malformed.csv",
      textBytes('Suite,Test,Status\n"Auth,login,passed')
    ),
    /opening quote is not closed/i
  );
});

test("rejects extension-spoofed binary reports before parsing", async () => {
  await assert.rejects(
    parseReportBytes("fake.pdf", textBytes(CSV_REPORT)),
    /valid PDF signature/i
  );
  await assert.rejects(
    parseReportBytes("fake.xlsx", textBytes(CSV_REPORT)),
    /valid Excel Open XML workbook/i
  );
  await assert.rejects(
    parseReportBytes("fake.xls", textBytes(CSV_REPORT)),
    /valid legacy Excel workbook/i
  );
});

test("rejects empty, oversized, and unsupported report files", async () => {
  await assert.rejects(
    parseReportBytes("empty.txt", new Uint8Array()),
    /file is empty/i
  );
  await assert.rejects(
    parseReportBytes("large.txt", new Uint8Array(5 * 1024 * 1024 + 1)),
    /larger than 5 MB/i
  );
  await assert.rejects(
    parseReportBytes("report.docx", textBytes("not a test report")),
    /unsupported report type/i
  );
});
