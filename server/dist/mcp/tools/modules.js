import { z } from "zod";
import { getReport } from "../../parser/store.js";
export const listModulesTool = {
    name: "listModules",
    description: "List every test suite (module) in the loaded report with its pass/fail/skip counts.",
    inputSchema: { reportId: z.string() },
    handler: async ({ reportId }) => {
        const r = getReport(reportId);
        return { suites: r.suites };
    },
};
export const getModuleTool = {
    name: "getModule",
    description: "Get details for one named test suite (module), including its failures.",
    inputSchema: { reportId: z.string(), name: z.string().describe("Suite name, e.g. 'AuthService'") },
    handler: async ({ reportId, name }) => {
        const r = getReport(reportId);
        const suite = r.suites.find((s) => s.name.toLowerCase() === name.toLowerCase());
        if (!suite)
            return { found: false, availableNames: r.suites.map((s) => s.name) };
        const failures = r.failures.filter((f) => f.suite.toLowerCase() === name.toLowerCase());
        return { found: true, suite, failures };
    },
};
