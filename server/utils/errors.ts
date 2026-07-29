export class CliNotInstalledError extends Error {
  constructor(provider: "claude") {
    super("Claude CLI not installed.");
    this.name = "CliNotInstalledError";
  }
}
export class AuthenticationError extends Error {
  constructor(detail?: string) {
    super(detail ? `Authentication failed. ${detail}` : "Authentication failed.");
    this.name = "AuthenticationError";
  }
}

export class ToolExecutionError extends Error {
  constructor(toolName: string, detail: string) {
    super(`Tool "${toolName}" failed: ${detail}`);
    this.name = "ToolExecutionError";
  }
}

export class McpUnavailableError extends Error {
  constructor(detail?: string) {
    super(detail ? `Unable to connect to MCP server. ${detail}` : "Unable to connect to MCP server.");
    this.name = "McpUnavailableError";
  }
}

export class NoReportLoadedError extends Error {
  constructor() {
    super("No report has been parsed for this request.");
    this.name = "NoReportLoadedError";
  }
}

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  if (err && typeof err === "object") {
    for (const key of ["message", "error", "stderr", "stdout"] as const) {
      const value = (err as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return "Unknown error.";
}

export function toErrorPayload(err: unknown): { error: string } {
  return { error: getErrorMessage(err) };
}
