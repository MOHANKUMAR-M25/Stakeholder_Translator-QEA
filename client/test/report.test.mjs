import assert from "node:assert/strict";
import test from "node:test";

import { parseReport, serializeReport } from "../report.js";

test("round-trips the canonical normalized report sent to translation", () => {
  const report = parseReport(
    JSON.stringify({
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
    })
  );

  assert.deepEqual(parseReport(serializeReport(report)), report);
});

test("uses Jest assertions instead of a suite-level failed status", () => {
  const report = parseReport(
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
  );

  assert.equal(report.totalTests, 2);
  assert.equal(report.passed, 1);
  assert.equal(report.failed, 1);
  assert.equal(report.failures[0]?.test, "payment checkout");
});

test("preserves aggregate JSON counts", () => {
  const report = parseReport(
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
  );

  assert.deepEqual(
    {
      totalTests: report.totalTests,
      passed: report.passed,
      failed: report.failed,
      skipped: report.skipped,
    },
    { totalTests: 4, passed: 2, failed: 1, skipped: 1 }
  );
});

test("counts reordered pytest summaries without dropping failures", () => {
  const report = parseReport("1 failed, 3 passed, 2 skipped in 1.2s");
  assert.deepEqual(
    {
      totalTests: report.totalTests,
      passed: report.passed,
      failed: report.failed,
      skipped: report.skipped,
    },
    { totalTests: 6, passed: 3, failed: 1, skipped: 2 }
  );
});

test("prefers Jest test counts over suite counts", () => {
  const report = parseReport(
    [
      "Test Suites: 1 failed, 2 passed, 3 total",
      "Tests:       5 failed, 10 passed, 15 total",
    ].join("\n")
  );
  assert.equal(report.totalTests, 15);
  assert.equal(report.passed, 10);
  assert.equal(report.failed, 5);
});

test("parses Mocha stats and nested err messages", () => {
  const report = parseReport(
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
  );

  assert.equal(report.totalTests, 2);
  assert.equal(report.passed, 1);
  assert.equal(report.failed, 1);
  assert.equal(report.failures[0]?.test, "payment checkout");
  assert.equal(report.failures[0]?.message, "Timeout");
});

test("treats Jest assertion durations as milliseconds", () => {
  const report = parseReport(
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
  );
  assert.equal(report.durationSec, 2);
});

test("keeps generic suites-shaped JSON durations in seconds", () => {
  const report = parseReport(
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
  );
  assert.equal(report.durationSec, 5);
});

test("collapses Playwright retries and carries the spec title", () => {
  const report = parseReport(
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
  );

  assert.equal(report.totalTests, 4);
  assert.equal(report.passed, 2);
  assert.equal(report.failed, 2);
  assert.equal(report.durationSec, 3);
  assert.equal(report.failures[0]?.test, "payment checkout");
  assert.equal(report.failures[0]?.message, "Timeout");
  assert.equal(report.failures[1]?.test, "unexpected pass");
});

test("accepts the same status and aggregate aliases as the server", () => {
  const detailed = parseReport(
    JSON.stringify({
      tests: [
        { name: "later", state: "not executed" },
        { name: "health", state: "green" },
        { name: "legacy", state: "ko" },
      ],
    })
  );
  assert.deepEqual(
    {
      passed: detailed.passed,
      failed: detailed.failed,
      skipped: detailed.skipped,
    },
    { passed: 1, failed: 1, skipped: 1 }
  );

  const aggregate = parseReport(
    JSON.stringify({
      suites: [{ name: "Auth", passed: 1, disabled: 2 }],
    })
  );
  assert.equal(aggregate.totalTests, 3);
  assert.equal(aggregate.skipped, 2);
});
