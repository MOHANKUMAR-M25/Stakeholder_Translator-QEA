export const AUDIENCES = [
  {
    key: "dm",
    label: "Delivery Manager",
    blurb: "A tight, 3-line operational update: what ran, what broke, what needs a call today.",
  },
  {
    key: "po",
    label: "Product Owner",
    blurb: "A one-page narrative on release risk, user impact, and the recommended path forward.",
  },
  {
    key: "client",
    label: "Client Slide",
    blurb: "A risk-flagged outline for external reporting — confident, honest, concise.",
  },
];


export const MODELS = [
  { id: "claude", label: "Claude" }
];
export const DEFAULT_MODEL = "claude";

export async function generateNarrative(audienceKey, reportPayload, config) {
  const backendUrl = (config?.backendUrl || "http://localhost:8787").replace(/\/$/, "");

  const res = await fetch(`${backendUrl}/api/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: config?.provider || "claude",
      execution: config?.execution || "standard",
      auth: config?.auth || "cli",
      apiKey: config?.auth === "api" ? config?.apiKey || "" : undefined,
      audience: audienceKey,
      ...reportPayload, // { report } or { reportBase64, reportFilename, reportFormat }
      webhookUrl: config?.webhookUrl || undefined,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Backend responded ${res.status}`);
  }

  const data = await res.json();
  return {
    text: data.text.trim(),
    source: data.source || "agent",
    trend: data.trend || null,
    trace: data.trace || null,
    webhook: data.webhook || { attempted: false, ok: false },
  };
}

/**
 * Normalizes a report (any of xml/json/csv/html/txt/xlsx/xls/pdf) into the shape the UI renders,
 * via the backend's shared parser — no LLM call, so this is fast and free. Used for the "Parse
 * report" preview step, including binary formats the browser can't parse on its own.
 */
export async function parseReportRemote(reportPayload, config) {
  const backendUrl = (config?.backendUrl || "http://localhost:8787").replace(/\/$/, "");
  const res = await fetch(`${backendUrl}/api/parse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reportPayload), // { report, reportFilename? } or { reportBase64, reportFilename, reportFormat }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Backend responded ${res.status}`);
  return data; // { reportId, report }
}

export async function fetchHistory(config) {
  const backendUrl = (config?.backendUrl || "http://localhost:8787").replace(/\/$/, "");
  const res = await fetch(`${backendUrl}/api/history`);
  if (!res.ok) throw new Error(`Backend responded ${res.status}`);
  const data = await res.json();
  return data.history || [];
}

export async function sendTestNotification(config, { reportId, message } = {}) {
  const backendUrl = (config?.backendUrl || "http://localhost:8787").replace(/\/$/, "");
  const res = await fetch(`${backendUrl}/api/notify-test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reportId, message, webhookUrl: config?.webhookUrl || undefined }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Backend responded ${res.status}`);
  return data;
}
