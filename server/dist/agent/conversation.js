export function startConversation(initialPrompt) {
    return [{ role: "user", content: initialPrompt }];
}
export function appendAssistantTurn(messages, content, toolCalls) {
    return [...messages, { role: "assistant", content, toolCalls }];
}
export function appendToolResult(messages, toolCallId, toolName, content, isError = false) {
    return [...messages, { role: "tool_result", toolCallId, toolName, content, isError }];
}
