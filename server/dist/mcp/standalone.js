import { startStdioMcpServer } from "./transport.js";
startStdioMcpServer().catch((err) => {
    console.error("MCP stdio server failed to start:", err);
    process.exit(1);
});
