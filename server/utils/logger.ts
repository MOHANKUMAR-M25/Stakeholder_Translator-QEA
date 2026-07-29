type LogFields = Record<string, unknown>;

function line(level: string, msg: string, fields?: LogFields) {
  const ts = new Date().toISOString();
  const extra = fields ? " " + JSON.stringify(fields) : "";
  console.log(`[${ts}] ${level.toUpperCase()} ${msg}${extra}`);
}

export const logger = {
  info: (msg: string, fields?: LogFields) => line("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => line("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => line("error", msg, fields),

  request: (fields: { provider: string; execution: string; auth: string }) =>
    line("info", "translate request", fields),

  toolCall: (fields: { tool: string; latencyMs: number; ok: boolean }) =>
    line("info", "tool call", fields),

  providerCall: (fields: { provider: string; latencyMs: number; promptTokens?: number; completionTokens?: number }) =>
    line("info", "provider call", fields),
};
