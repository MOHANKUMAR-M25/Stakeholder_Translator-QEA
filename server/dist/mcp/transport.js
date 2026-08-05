import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";
import { buildMcpServer } from "./server.js";
import { McpUnavailableError } from "../utils/errors.js";
export function getStandaloneEntryPath() {
    return fileURLToPath(new URL("./standalone.js", import.meta.url));
}
export async function createInMemoryConnectedClient() {
    try {
        const server = buildMcpServer();
        const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: "stakeholder-translator-agent", version: "1.0.0" });
        await server.connect(serverTransport);
        await client.connect(clientTransport);
        return client;
    }
    catch (err) {
        throw new McpUnavailableError(err instanceof Error ? err.message : undefined);
    }
}
export async function startStdioMcpServer() {
    const server = buildMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
export async function listAvailableTools() {
    const client = await createInMemoryConnectedClient();
    try {
        const { tools } = await client.listTools();
        return tools.map((t) => ({
            name: t.name,
            description: t.description || "",
            inputSchema: t.inputSchema,
        }));
    }
    finally {
        await client.close();
    }
}
