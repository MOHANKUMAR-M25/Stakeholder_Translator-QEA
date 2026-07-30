import { createInMemoryConnectedClient } from "../mcp/transport.js";
import { runAgentLoop } from "./loop.js";
import { startConversation } from "./conversation.js";
export async function runAgenticTurn(provider, initialPrompt) {
    const client = await createInMemoryConnectedClient();
    try {
        const { tools } = await client.listTools();
        const toolSpecs = tools.map((t) => ({
            name: t.name,
            description: t.description || "",
            inputSchema: t.inputSchema,
        }));
        const messages = startConversation(initialPrompt);
        return await runAgentLoop(provider, client, toolSpecs, messages);
    }
    finally {
        await client.close();
    }
}
