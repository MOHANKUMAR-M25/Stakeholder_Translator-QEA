import express from "express";
import cors from "cors";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { env } from "./config/env.js";
import { translate } from "./services/translator.js";
import { getErrorMessage, toErrorPayload } from "./utils/errors.js";
import { logger } from "./utils/logger.js";
import type { TranslateRequest } from "./providers/types.js";
import {
  canonicalReportText,
  parseBase64ReportFile,
} from "./parser/files.js";

const execFileAsync = promisify(execFile);

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const isWindows = process.platform === "win32";

async function cliAvailable(bin: string) {
    try {
        
        await execFileAsync(bin, ["--version"], {
            shell: isWindows,
            windowsHide: true
        });
        return true;
    }
    catch {
        return false;
    }
}

app.get("/api/health", async (_req, res) => {
  const claudeCli = await cliAvailable(env.claudeCliBin);
  res.json({
    ok: claudeCli,
    providers: {
      claude: { cli: claudeCli, apiKeyConfigured: Boolean(env.claudeApiKey) },
    },
  });
});

app.post("/api/parse-file", async (req, res) => {
  const body = req.body as {
    fileName?: unknown;
    contentBase64?: unknown;
  };

  if (
    typeof body.fileName !== "string" ||
    !body.fileName.trim() ||
    body.fileName.length > 255
  ) {
    return res.status(400).json({ error: "`fileName` is required." });
  }
  if (typeof body.contentBase64 !== "string") {
    return res.status(400).json({ error: "`contentBase64` is required." });
  }

  try {
    const report = await parseBase64ReportFile(
      body.fileName.trim(),
      body.contentBase64
    );
    return res.json({
      report,
      canonicalReport: canonicalReportText(report),
    });
  } catch (err) {
    logger.warn("report file parsing failed", {
      fileName: body.fileName,
      message: getErrorMessage(err),
    });
    return res.status(400).json(toErrorPayload(err));
  }
});


app.post("/api/translate", async (req, res) => {
  const body = req.body as Partial<TranslateRequest>;

  if (!body.provider || !["claude"].includes(body.provider)) {
    return res.status(400).json({ error: '`provider` must be "claude".' });
  }
  if (!body.execution || !["standard", "agentic"].includes(body.execution)) {
    return res.status(400).json({ error: '`execution` must be "standard" or "agentic".' });
  }
  if (!body.auth || !["cli", "api"].includes(body.auth)) {
    return res.status(400).json({ error: '`auth` must be "cli" or "api".' });
  }
  if (!body.audience || !["dm", "po", "client"].includes(body.audience)) {
    return res.status(400).json({ error: '`audience` must be "dm", "po", or "client".' });
  }
  if (!body.report || typeof body.report !== "string") {
    return res.status(400).json({ error: "`report` (raw report text) is required." });
  }
  if (body.auth === "api" && !body.apiKey) {
    return res.status(400).json({ error: "`apiKey` is required when auth is \"api\"." });
  }

  try {
    const result = await translate(body as TranslateRequest);
    res.json(result);
  } catch (err) {
    logger.error("translate failed", { message: getErrorMessage(err) });
    res.status(500).json(toErrorPayload(err));
  }
});

const server = app.listen(env.port, () => {
  logger.info(`Stakeholder Translator backend running on http://localhost:${env.port}`);
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    logger.error(
      `Port ${env.port} is already in use. The backend may already be running at http://localhost:${env.port}.`
    );
    process.exit(1);
  }

  logger.error("Backend failed to start", { message: error.message });
  process.exit(1);
});
