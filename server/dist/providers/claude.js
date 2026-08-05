import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { AuthenticationError } from "../utils/errors.js";
import { runCliWithStdin } from "../utils/runCli.js";
import { getStandaloneEntryPath } from "../mcp/transport.js";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
const MCP_SERVER_NAME = "stakeholder-translator";
function toAnthropicMessages(messages) {
    const out = [];
    for (const m of messages) {
        if (m.role === "user") {
            out.push({ role: "user", content: m.content });
        }
        else if (m.role === "assistant") {
            const content = [];
            if (m.content)
                content.push({ type: "text", text: m.content });
            for (const tc of m.toolCalls || []) {
                content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
            }
            out.push({ role: "assistant", content });
        }
        else if (m.role === "tool_result") {
            out.push({
                role: "user",
                content: [
                    {
                        type: "tool_result",
                        tool_use_id: m.toolCallId,
                        content: m.content,
                        is_error: m.isError || false,
                    },
                ],
            });
        }
    }
    return out;
}
class ClaudeApiProvider {
    apiKey;
    name = "claude";
    constructor(apiKey) {
        this.apiKey = apiKey;
    }
    async run(messages, tools) {
        const client = new Anthropic({ apiKey: this.apiKey });
        const start = Date.now();
        let response;
        try {
            response = await client.messages.create({
                model: "claude-sonnet-4-6",
                max_tokens: 1536,
                messages: toAnthropicMessages(messages),
                tools: tools.length
                    ? tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }))
                    : undefined,
            });
        }
        catch (err) {
            if (err?.status === 401 || err?.status === 403)
                throw new AuthenticationError(err?.message);
            throw err;
        }
        logger.providerCall({
            provider: "claude-api",
            latencyMs: Date.now() - start,
            promptTokens: response.usage?.input_tokens,
            completionTokens: response.usage?.output_tokens,
        });
        const toolCalls = [];
        let content = "";
        for (const block of response.content) {
            if (block.type === "text")
                content += block.text;
            else if (block.type === "tool_use") {
                toolCalls.push({ id: block.id, name: block.name, input: block.input });
            }
        }
        return {
            content,
            toolCalls,
            stopReason: response.stop_reason === "tool_use" ? "tool_use" : "end",
            usage: { promptTokens: response.usage?.input_tokens, completionTokens: response.usage?.output_tokens },
        };
    }
}
class ClaudeCliProvider {
    name = "claude";
    async run(messages, tools) {
        const prompt = messages
            .filter((m) => m.role === "user")
            .map((m) => m.content)
            .join("\n\n");
        // The -p flag is restored so Claude runs headlessly and doesn't crash trying to open a terminal UI
        const args = ["-p", "--output-format", "text"];
        let tempDir = null;
        if (tools.length > 0) {
            tempDir = await mkdtemp(join(tmpdir(), "stakeholder-mcp-"));
            const configPath = join(tempDir, "mcp-config.json");
            await writeFile(configPath, JSON.stringify({
                mcpServers: {
                    [MCP_SERVER_NAME]: { command: "node", args: [getStandaloneEntryPath()] },
                },
            }));
            args.push("--mcp-config", configPath, "--allowedTools", `mcp__${MCP_SERVER_NAME}__*`);
        }
        const start = Date.now();
        try {
            const { stdout } = await runCliWithStdin(env.claudeCliBin, args, prompt, {
                maxBuffer: 10 * 1024 * 1024,
                timeoutMs: 180000,
            });
            logger.providerCall({ provider: "claude-cli", latencyMs: Date.now() - start });
            return { content: stdout.trim(), toolCalls: [], stopReason: "end" };
        }
        catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            if (/auth|login|unauthorized/i.test(detail)) {
                throw new AuthenticationError(detail);
            }
            throw err;
        }
        finally {
            if (tempDir)
                await rm(tempDir, { recursive: true, force: true }).catch(() => { });
        }
    }
}
export function createClaudeProvider(auth, apiKey) {
    if (auth === "api") {
        if (!apiKey)
            throw new AuthenticationError("No API key provided for Claude API mode.");
        return new ClaudeApiProvider(apiKey);
    }
    return new ClaudeCliProvider();
}
