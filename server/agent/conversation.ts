import type { AgentMessage, ToolCallRequest } from "../providers/types.js";

export function startConversation(initialPrompt: string): AgentMessage[] {
  return [{ role: "user", content: initialPrompt }];
}

export function appendAssistantTurn(
  messages: AgentMessage[],
  content: string,
  toolCalls: ToolCallRequest[]
): AgentMessage[] {
  return [...messages, { role: "assistant", content, toolCalls }];
}

export function appendToolResult(
  messages: AgentMessage[],
  toolCallId: string,
  toolName: string,
  content: string,
  isError = false
): AgentMessage[] {
  return [...messages, { role: "tool_result", toolCallId, toolName, content, isError }];
}
