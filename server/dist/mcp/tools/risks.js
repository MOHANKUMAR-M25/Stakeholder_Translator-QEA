import { z } from "zod";
import { getReport } from "../../parser/store.js";
export const getRiskAnalysisTool = {
    name: "getRiskAnalysis",
    description: "Get the computed risk level (RAG) and which specific failures are driving it — e.g. high-impact " +
        "keyword matches (auth, payment, security, etc.) versus overall fail rate.",
    inputSchema: { reportId: z.string() },
    handler: async ({ reportId }) => {
        const r = getReport(reportId);
        const highImpact = r.failures.filter((f) => f.highImpact);
        const failRate = r.totalTests > 0 ? Math.round((r.failed / r.totalTests) * 1000) / 10 : 0;
        return {
            rag: r.rag,
            ragLabel: r.ragLabel,
            failRatePct: failRate,
            highImpactFailureCount: highImpact.length,
            highImpactFailures: highImpact,
            reasoning: highImpact.length > 0
                ? "Risk is elevated because at least one failure touches a critical area (auth/payment/security/etc.), regardless of overall fail rate."
                : failRate > 20
                    ? "Risk is elevated primarily due to a high overall fail rate (>20%)."
                    : failRate > 5
                        ? "Risk is moderate due to a moderate fail rate (5-20%)."
                        : "Risk is low — fail rate is under 5% with no high-impact failures.",
        };
    },
};
