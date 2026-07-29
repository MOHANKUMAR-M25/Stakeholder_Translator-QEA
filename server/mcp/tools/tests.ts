import { z } from "zod";
import { getReport } from "../../parser/store.js";

export const listFailedTestsTool = {
  name: "listFailedTests",
  description: "List every failed test in the loaded report, with suite, message, and high-impact flag.",
  inputSchema: { reportId: z.string() },
  handler: async ({ reportId }: { reportId: string }) => {
    const r = getReport(reportId);
    return { failures: r.failures };
  },
};

export const getTestTool = {
  name: "getTest",
  description: "Get details for one specific failed test by name.",
  inputSchema: { reportId: z.string(), testName: z.string() },
  handler: async ({ reportId, testName }: { reportId: string; testName: string }) => {
    const r = getReport(reportId);
    const match = r.failures.find((f:any) => f.test.toLowerCase() === testName.toLowerCase());
    if (!match) return { found: false };
    return { found: true, ...match };
  },
};
