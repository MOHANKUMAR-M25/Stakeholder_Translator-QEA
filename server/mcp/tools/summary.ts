import { z } from "zod";
import { getReport } from "../../parser/store.js";

export const getSummaryTool = {
  name: "getSummary",
  description: "Get the overall pass/fail/skip counts, pass rate, and computed risk level for the loaded report.",
  inputSchema: { reportId: z.string() },
  handler: async ({ reportId }: { reportId: string }) => {
    const r = getReport(reportId);
    return {
      totalTests: r.totalTests,
      passed: r.passed,
      failed: r.failed,
      skipped: r.skipped,
      passRatePct: r.passRatePct,
      durationSec: r.durationSec,
      rag: r.rag,
      ragLabel: r.ragLabel,
    };
  },
};
