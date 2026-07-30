import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TOOL_REGISTRY } from "./registry.js";
export function buildMcpServer() {
    const server = new McpServer({ name: "stakeholder-translator", version: "1.0.0" });
    for (const tool of TOOL_REGISTRY) {
        server.registerTool(tool.name, { description: tool.description, inputSchema: tool.inputSchema }, async (args) => {
            const result = await tool.handler(args);
            return { content: [{ type: "text", text: JSON.stringify(result) }] };
        });
    }
    return server;
}
