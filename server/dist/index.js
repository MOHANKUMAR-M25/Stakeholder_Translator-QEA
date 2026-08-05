import express from "express";
import cors from "cors";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { env } from "./config/env.js";
import { translate } from "./services/translator.js";
import { getHistory, getReport, ingestReport } from "./parser/store.js";
import { notifyWebhook, buildFallbackAlert } from "./services/webhook.js";
import { getErrorMessage, toErrorPayload } from "./utils/errors.js";
import { logger } from "./utils/logger.js";
const execFileAsync = promisify(execFile);
const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));
const isWindows = process.platform === "win32";
async function cliAvailable(bin) {
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
        webhookConfigured: Boolean(env.webhookUrl),
    });
});
// Rolling run history — used by the frontend to draw the trend sparkline.
app.get("/api/history", (_req, res) => {
    res.json({ history: getHistory() });
});
// Lets the UI fire a one-off notification (e.g. a "Send test alert" button in Settings)
// without needing a red run on hand.
app.post("/api/notify-test", async (req, res) => {
    const body = req.body;
    try {
        let text = body.message;
        if (!text) {
            if (!body.reportId) {
                return res.status(400).json({ error: "Provide either `reportId` or `message`." });
            }
            const report = getReport(body.reportId);
            text = buildFallbackAlert(report);
        }
        const result = await notifyWebhook(text, body.webhookUrl);
        if (!result.attempted) {
            return res.status(400).json({ error: "No webhook URL configured (set WEBHOOK_URL on the backend, or pass one in the request)." });
        }
        res.json(result);
    }
    catch (err) {
        logger.error("notify-test failed", { message: getErrorMessage(err) });
        res.status(500).json(toErrorPayload(err));
    }
});
function validateReportPayload(body) {
    const hasText = typeof body.report === "string" && body.report.trim().length > 0;
    const hasBase64 = typeof body.reportBase64 === "string" && body.reportBase64.trim().length > 0;
    if (!hasText && !hasBase64) {
        return "Provide `report` (raw text) or `reportBase64` (for .xlsx/.xls/.pdf uploads).";
    }
    return null;
}
// Parse-only endpoint: normalizes a report into the shared shape without calling the model.
// Used by the frontend's "Parse report" step so binary formats (.xlsx/.xls/.pdf) get the same
// preview treatment as pasted text, via one shared parser instead of duplicating 8 format
// parsers in the browser.
app.post("/api/parse", async (req, res) => {
    const body = req.body;
    const validationError = validateReportPayload(body);
    if (validationError)
        return res.status(400).json({ error: validationError });
    try {
        const { reportId, report } = await ingestReport({
            text: body.report,
            base64: body.reportBase64,
            filename: body.reportFilename,
            format: body.reportFormat,
        });
        res.json({ reportId, report });
    }
    catch (err) {
        logger.error("parse failed", { message: getErrorMessage(err) });
        res.status(400).json(toErrorPayload(err));
    }
});
app.post("/api/translate", async (req, res) => {
    const body = req.body;
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
    const reportValidationError = validateReportPayload(body);
    if (reportValidationError)
        return res.status(400).json({ error: reportValidationError });
    if (body.auth === "api" && !body.apiKey) {
        return res.status(400).json({ error: "`apiKey` is required when auth is \"api\"." });
    }
    // `webhookUrl` is optional — if present it overrides the server's WEBHOOK_URL env var for this request only.
    try {
        const result = await translate(body);
        res.json(result);
    }
    catch (err) {
        logger.error("translate failed", { message: getErrorMessage(err) });
        res.status(500).json(toErrorPayload(err));
    }
});
const server = app.listen(env.port, () => {
    logger.info(`Stakeholder Translator backend running on http://localhost:${env.port}`);
});
server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
        logger.error(`Port ${env.port} is already in use. The backend may already be running at http://localhost:${env.port}.`);
        process.exit(1);
    }
    logger.error("Backend failed to start", { message: error.message });
    process.exit(1);
});
