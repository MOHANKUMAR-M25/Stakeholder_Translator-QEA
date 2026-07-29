import { z } from "zod";
import { getReport } from "../../parser/store.js";

export const getMetricsTool = {
  name: "getMetrics",
  description: "Get computed metrics: pass rate, fail rate, skip rate, and per-suite pass rates.",
  inputSchema: { reportId: z.string() },
  handler: async ({ reportId }: { reportId: string }) => {
    const r = getReport(reportId);
    const rate = (n: number) => (r.totalTests > 0 ? Math.round((n / r.totalTests) * 1000) / 10 : 0);
    return {
      passRatePct: rate(r.passed),
      failRatePct: rate(r.failed),
      skipRatePct: rate(r.skipped),
      perSuite: r.suites.map((s: any) => ({
        name: s.name,
        passRatePct: s.total > 0 ? Math.round((s.passed / s.total) * 1000) / 10 : 0,
      })),
    };
  },
};
