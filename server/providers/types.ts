/** A tool call the model asked to make. */
export interface ToolCallRequest {
  id: string;
  name: string;
  input: Record<string, unknown>;
}


export type AgentMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCallRequest[] }
  | { role: "tool_result"; toolCallId: string; toolName: string; content: string; isError?: boolean };


export interface AgentToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AgentUsage {
  promptTokens?: number;
  completionTokens?: number;
}

export interface AgentResponse {
  content: string;
  toolCalls: ToolCallRequest[];
  stopReason: "tool_use" | "end";
  usage?: AgentUsage;
}


export interface AgentProvider {
  readonly name: "claude";
  run(messages: AgentMessage[], tools: AgentToolSpec[]): Promise<AgentResponse>;
}

export type ExecutionMode = "standard" | "agentic";
export type AuthMode = "cli" | "api";

export interface TranslateRequest {
  provider: "claude";
  execution: ExecutionMode;
  auth: AuthMode;
  apiKey?: string;
  audience: "dm" | "po" | "client";
  report: string; 
}
