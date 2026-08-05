import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { AgentMessage, AgentProvider, AgentToolSpec, AgentTraceEntry } from "../providers/types.js";
import { appendAssistantTurn, appendToolResult } from "./conversation.js";
import { executeToolCall } from "./executor.js";
import { logger } from "../utils/logger.js";

const MAX_ITERATIONS = 12;

export interface AgentLoopResult {
  content: string;
  trace: AgentTraceEntry[];
}

export async function runAgentLoop(
  provider: AgentProvider,
  mcpClient: Client,
  tools: AgentToolSpec[],
  initialMessages: AgentMessage[]
): Promise<AgentLoopResult> {
  let messages = initialMessages;
  const trace: AgentTraceEntry[] = [];

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const response = await provider.run(messages, tools);

    if (response.stopReason === "end" || response.toolCalls.length === 0) {
      return { content: response.content, trace };
    }

    messages = appendAssistantTurn(messages, response.content, response.toolCalls);

    for (const call of response.toolCalls) {
      const start = Date.now();
      const result = await executeToolCall(mcpClient, call);
      trace.push({
        iteration: iteration + 1,
        toolName: result.toolName,
        input: call.input,
        output: result.content,
        isError: result.isError,
        latencyMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      });
      messages = appendToolResult(messages, result.toolCallId, result.toolName, result.content, result.isError);
    }
  }

  logger.warn("Agent loop hit max iterations without a final answer", { provider: provider.name });
  throw new Error(`${provider.name} did not produce a final answer within ${MAX_ITERATIONS} tool-calling turns.`);
}
