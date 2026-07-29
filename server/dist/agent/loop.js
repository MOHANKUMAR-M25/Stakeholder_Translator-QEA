import { appendAssistantTurn, appendToolResult } from "./conversation.js";
import { executeToolCall } from "./executor.js";
import { logger } from "../utils/logger.js";
const MAX_ITERATIONS = 12;
export async function runAgentLoop(provider, mcpClient, tools, initialMessages) {
    let messages = initialMessages;
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        const response = await provider.run(messages, tools);
        if (response.stopReason === "end" || response.toolCalls.length === 0) {
            return response.content;
        }
        messages = appendAssistantTurn(messages, response.content, response.toolCalls);
        for (const call of response.toolCalls) {
            const result = await executeToolCall(mcpClient, call);
            messages = appendToolResult(messages, result.toolCallId, result.toolName, result.content, result.isError);
        }
    }
    logger.warn("Agent loop hit max iterations without a final answer", { provider: provider.name });
    throw new Error(`${provider.name} did not produce a final answer within ${MAX_ITERATIONS} tool-calling turns.`);
}
