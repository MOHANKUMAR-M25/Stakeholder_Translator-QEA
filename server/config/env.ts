export const env = {
  port: Number(process.env.PORT || 8787),
  claudeApiKey: process.env.CLAUDE_API_KEY || "",
  claudeCliBin: process.env.CLAUDE_CLI_BIN || "claude.cmd",
  webhookUrl: process.env.WEBHOOK_URL || "",

} as const;
