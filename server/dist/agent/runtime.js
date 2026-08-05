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
        const { content, trace } = await runAgentLoop(provider, client, toolSpecs, messages);
        return { text: content, trace };
    }
    finally {
        await client.close();
    }
}
