function line(level, msg, fields) {
    const ts = new Date().toISOString();
    const extra = fields ? " " + JSON.stringify(fields) : "";
    console.log(`[${ts}] ${level.toUpperCase()} ${msg}${extra}`);
}
export const logger = {
    info: (msg, fields) => line("info", msg, fields),
    warn: (msg, fields) => line("warn", msg, fields),
    error: (msg, fields) => line("error", msg, fields),
    request: (fields) => line("info", "translate request", fields),
    toolCall: (fields) => line("info", "tool call", fields),
    providerCall: (fields) => line("info", "provider call", fields),
};
