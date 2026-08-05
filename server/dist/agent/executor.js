import { ToolExecutionError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
/** Executes one model-requested tool call against the connected MCP client. */
export async function executeToolCall(client, call) {
    const start = Date.now();
    try {
        const result = await client.callTool({ name: call.name, arguments: call.input });
        const latencyMs = Date.now() - start;
        logger.toolCall({ tool: call.name, latencyMs, ok: true });
        const textBlock = Array.isArray(result.content)
            ? result.content.find((b) => b.type === "text")
            : undefined;
        const content = textBlock?.text ?? JSON.stringify(result.content ?? {});
        return { toolCallId: call.id, toolName: call.name, content, isError: Boolean(result.isError) };
    }
    catch (err) {
        logger.toolCall({ tool: call.name, latencyMs: Date.now() - start, ok: false });
        const message = err instanceof Error ? err.message : String(err);
        throw new ToolExecutionError(call.name, message);
    }
}
