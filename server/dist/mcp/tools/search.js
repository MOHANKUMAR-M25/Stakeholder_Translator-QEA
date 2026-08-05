import { z } from "zod";
import { getReport } from "../../parser/store.js";
export const searchTool = {
    name: "search",
    description: "Free-text search across suite names, test names, and failure messages in the loaded report.",
    inputSchema: { reportId: z.string(), query: z.string() },
    handler: async ({ reportId, query }) => {
        const r = getReport(reportId);
        const q = query.toLowerCase();
        const matchingSuites = r.suites.filter((s) => s.name.toLowerCase().includes(q));
        const matchingFailures = r.failures.filter((f) => f.suite.toLowerCase().includes(q) || f.test.toLowerCase().includes(q) || f.message.toLowerCase().includes(q));
        return { matchingSuites, matchingFailures };
    },
};
