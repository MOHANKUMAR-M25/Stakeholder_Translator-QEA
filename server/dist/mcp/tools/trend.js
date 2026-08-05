import { z } from "zod";
import { getReport, computeTrend } from "../../parser/store.js";
export const getTrendTool = {
    name: "getTrend",
    description: "Compare the loaded report against the immediately preceding run that was translated on this backend. " +
        "Returns the pass-rate delta and which specific tests newly started failing or got fixed since then. " +
        "Use this before claiming something is a 'regression' or 'new' issue — don't infer trend from a single run.",
    inputSchema: { reportId: z.string() },
    handler: async ({ reportId }) => {
        const report = getReport(reportId);
        const trend = computeTrend(reportId, report);
        return trend;
    },
};
