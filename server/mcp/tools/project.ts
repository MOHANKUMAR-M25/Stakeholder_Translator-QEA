import { z } from "zod";
import { getReport } from "../../parser/store.js";

export const getProjectInfoTool = {
  name: "getProjectInfo",
  description: "Get high-level identifying info about the currently loaded test report (suite count, total tests).",
  inputSchema: { reportId: z.string().describe("The report id returned when the report was ingested.") },
  handler: async ({ reportId }: { reportId: string }) => {
    const report = getReport(reportId);
    return {
      suiteCount: report.suites.length,
      totalTests: report.totalTests,
      durationSec: report.durationSec,
    };
  },
};
