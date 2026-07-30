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

export async function generateNarrative(audienceKey, rawReportText, config) {
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
      report: rawReportText,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Backend responded ${res.status}`);
  }

  const data = await res.json();
  return { text: data.text.trim(), source: data.source || "agent" };
}
