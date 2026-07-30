import { z } from "zod";
export const AUDIENCES = [
    {
        key: "dm",
        label: "Delivery Manager",
        brief: "Write a 3-line, SMS-style update. Tight, operational, no fluff. What ran, what broke, " +
            "what needs a decision from them today. No preamble, no sign-off — just the 3 lines.",
    },
    {
        key: "po",
        label: "Product Owner",
        brief: "Write a 1-page narrative for someone who owns the roadmap, not the test suite. Cover: " +
            "what this means for the release, user-facing risk, the tradeoff/decision they need to " +
            "make, and a clear recommendation. Prose, not bullet points.",
    },
    {
        key: "client",
        label: "Client Slide",
        brief: "Write a risk-flagged slide outline for an external client. Start with a RAG flag on its " +
            "own line in brackets, e.g. [AMBER]. Then 4-6 bullet points max, confident and non-alarming " +
            "but honest about risk. End with one clear recommendation or next step.",
    },
];
export const listStakeholdersTool = {
    name: "listStakeholders",
    description: "List the stakeholder audiences this translator writes for (key + label + writing brief).",
    inputSchema: {},
    handler: async () => ({ stakeholders: AUDIENCES }),
};
export const getStakeholderTool = {
    name: "getStakeholder",
    description: "Get the writing brief for one stakeholder audience by key (dm, po, or client).",
    inputSchema: { key: z.enum(["dm", "po", "client"]) },
    handler: async ({ key }) => {
        const found = AUDIENCES.find((a) => a.key === key);
        if (!found)
            return { found: false };
        return { found: true, ...found };
    },
};
