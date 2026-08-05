export class CliNotInstalledError extends Error {
    constructor(provider) {
        super("Claude CLI not installed.");
        this.name = "CliNotInstalledError";
    }
}
export class AuthenticationError extends Error {
    constructor(detail) {
        super(detail ? `Authentication failed. ${detail}` : "Authentication failed.");
        this.name = "AuthenticationError";
    }
}
export class ToolExecutionError extends Error {
    constructor(toolName, detail) {
        super(`Tool "${toolName}" failed: ${detail}`);
        this.name = "ToolExecutionError";
    }
}
export class McpUnavailableError extends Error {
    constructor(detail) {
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
export function getErrorMessage(err) {
    if (err instanceof Error && err.message)
        return err.message;
    if (typeof err === "string" && err)
        return err;
    if (err && typeof err === "object") {
        for (const key of ["message", "error", "stderr", "stdout"]) {
            const value = err[key];
            if (typeof value === "string" && value.trim())
                return value.trim();
        }
    }
    return "Unknown error.";
}
export function toErrorPayload(err) {
    return { error: getErrorMessage(err) };
}
