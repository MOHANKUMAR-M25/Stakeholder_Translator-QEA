import type { AgentProvider } from "../providers/types.js";
import { createInMemoryConnectedClient } from "../mcp/transport.js";
import { runAgentLoop } from "./loop.js";
import { startConversation } from "./conversation.js";


export async function runAgenticTurn(provider: AgentProvider, initialPrompt: string): Promise<string> {
  const client = await createInMemoryConnectedClient();
  try {
    const { tools } = await client.listTools();
    const toolSpecs = tools.map((t) => ({
      name: t.name,
      description: t.description || "",
      inputSchema: t.inputSchema as Record<string, unknown>,
    }));

    const messages = startConversation(initialPrompt);
    return await runAgentLoop(provider, client, toolSpecs, messages);
  } finally {
    await client.close();
  }
}
