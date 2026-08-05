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
  /** Raw text content — for xml/json/csv/html/txt/log reports pasted or uploaded as text. */
  report?: string;
  /** Base64-encoded content — required for binary formats (xlsx/xls/pdf). */
  reportBase64?: string;
  /** Original filename, used to infer the format from its extension. */
  reportFilename?: string;
  /** Explicit format override, e.g. "csv", ".xlsx". */
  reportFormat?: string;
  /** Optional per-request override for the auto-notification webhook (falls back to server env var). */
  webhookUrl?: string;
}

/** One step of the agentic tool-calling loop, kept for the "show your work" trace view in the UI. */
export interface AgentTraceEntry {
  iteration: number;
  toolName: string;
  input: Record<string, unknown>;
  output: string;
  isError: boolean;
  latencyMs: number;
  timestamp: string;
}
