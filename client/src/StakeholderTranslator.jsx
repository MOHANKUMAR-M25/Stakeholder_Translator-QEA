import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { SAMPLE_JUNIT, parseReport } from "../report.js";
import {
  AUDIENCES,
  MODELS,
  DEFAULT_MODEL,
  generateNarrative,
} from "../narrative.js";
import "./StakeholderTranslator.css";

const STAGES = ["Ingest", "Normalize", "Frame", "Generate", "Present"];
const STORAGE_KEY = "stakeholder-translator.settings";

const DEFAULT_BACKEND_URL = "http://localhost:8787";

function loadConfig() {
  const defaults = { backendUrl: DEFAULT_BACKEND_URL, provider: "claude", execution: "standard", auth: "cli", apiKey: "" };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

/* ---------- Small presentational pieces ---------- */

function PipelineRail({ stageIndex }) {
  return (
    <nav className="pipeline" aria-label="Pipeline progress">
      {STAGES.map((label, i) => {
        const state = i < stageIndex ? "done" : i === stageIndex ? "active" : "todo";
        return (
          <div key={label} className={`pipeline__step pipeline__step--${state}`}>
            <span className="pipeline__marker" aria-hidden="true">
              {state === "done" ? "✓" : i + 1}
            </span>
            <span className="pipeline__label">{label}</span>
          </div>
        );
      })}
    </nav>
  );
}

function RagBadge({ rag, label }) {
  return (
    <span className={`rag rag--${rag}`}>
      <span className="rag__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

function StatTile({ label, value, tone }) {
  return (
    <div className={`tile ${tone ? `tile--${tone}` : ""}`}>
      <div className="tile__value">{value}</div>
      <div className="tile__label">{label}</div>
    </div>
  );
}

function SuiteMeter({ suite }) {
  const total = Math.max(suite.total, 1);
  const seg = (n) => `${(n / total) * 100}%`;
  return (
    <div className="suite">
      <div className="suite__head">
        <span className="suite__name">{suite.name}</span>
        <span className="suite__count">
          {suite.passed}/{suite.total} passed
          {suite.failed > 0 ? `, ${suite.failed} failed` : ""}
          {suite.skipped > 0 ? `, ${suite.skipped} skipped` : ""}
        </span>
      </div>
      <div
        className="meter"
        role="img"
        aria-label={`${suite.passed} passed, ${suite.failed} failed, ${suite.skipped} skipped of ${suite.total}`}
      >
        {suite.passed > 0 && (
          <span className="meter__seg meter__seg--pass" style={{ width: seg(suite.passed) }} />
        )}
        {suite.failed > 0 && (
          <span className="meter__seg meter__seg--fail" style={{ width: seg(suite.failed) }} />
        )}
        {suite.skipped > 0 && (
          <span className="meter__seg meter__seg--skip" style={{ width: seg(suite.skipped) }} />
        )}
      </div>
    </div>
  );
}

/** "claude-cli-agentic" -> "Claude · CLI · Agentic" */
function formatSourceLabel(source) {
  const [provider, auth, execution] = (source || "").split("-");
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
  return [cap(provider), auth ? auth.toUpperCase() : "", cap(execution)].filter(Boolean).join(" · ");
}

function ExecutionConfig({ config, onChange, health }) {
  const set = (patch) => onChange((prev) => ({ ...prev, ...patch }));
  const providerHealth = health?.providers?.[config.provider];

  return (
    <div className="card" style={{ background: "var(--surface-2)", marginBottom: 14 }}>
      <div className="card__head-actions" style={{ gap: 20, flexWrap: "wrap" }}>
        <label className="field" style={{ minWidth: 160 }}>
          <span className="field__label">Provider</span>
          <select
            className="field__input"
            value={config.provider}
            onChange={(e) => set({ provider: e.target.value })}
            disabled
          >
            <option value="claude">Claude</option>
          </select>
        </label>

        <label className="field" style={{ minWidth: 180 }}>
          <span className="field__label">Execution Mode</span>
          <select
            className="field__input"
            value={config.execution}
            onChange={(e) => set({ execution: e.target.value })}
          >
            <option value="standard">Standard</option>
            <option value="agentic">Agentic (MCP)</option>
          </select>
        </label>

        <label className="field" style={{ minWidth: 160 }}>
          <span className="field__label">Authentication</span>
          <select className="field__input" value={config.auth} onChange={(e) => set({ auth: e.target.value })}>
            <option value="cli">CLI</option>
            <option value="api">API Key</option>
          </select>
        </label>

        {config.auth === "api" && (
          <label className="field" style={{ minWidth: 220, flex: 1 }}>
            <span className="field__label">
              {config.provider === "claude" ? "Anthropic" : "OpenAI"} API key
            </span>
            <input
              className="field__input"
              type="password"
              value={config.apiKey}
              onChange={(e) => set({ apiKey: e.target.value })}
              placeholder={config.provider === "claude" ? "sk-ant-…" : "sk-…"}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        )}
      </div>

      {config.auth === "cli" && (
        <p className="field__hint" style={{ marginTop: 10 }}>
          {providerHealth?.cli
            ? "Claude CLI detected — no API key needed."
            : "Claude CLI not detected on the backend host. Install it, or switch Authentication to API Key."}
        </p>
      )}
    </div>
  );
}

/* ---------- Main component ---------- */

export default function StakeholderTranslator({ user, onSignOut }) {
  const [rawInput, setRawInput] = useState("");
  const [normalized, setNormalized] = useState(null);
  const [parseError, setParseError] = useState("");
  const [fileError, setFileError] = useState("");
  const [activeAudience, setActiveAudience] = useState("dm");
  const [narratives, setNarratives] = useState({});
  const [generationError, setGenerationError] = useState({});
  const [loadingAudience, setLoadingAudience] = useState(null);
  const [copiedKey, setCopiedKey] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const [config, setConfig] = useState(loadConfig);
  const [showSettings, setShowSettings] = useState(false);
  const [health, setHealth] = useState(null); // full /api/health payload, or null while checking

  const fileInputRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      fetch(`${config.backendUrl.replace(/\/$/, "")}/api/health`)
        .then((r) => r.json())
        .then((data) => !cancelled && setHealth(data))
        .catch(() => !cancelled && setHealth({ ok: false }));
    };
    check();
    const id = setInterval(check, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [config.backendUrl]);

  useEffect(() => {
    if (!showMenu) return;

    const handlePointerDown = (event) => {
      if (!menuRef.current?.contains(event.target)) setShowMenu(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setShowMenu(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showMenu]);

  const stageIndex = useMemo(() => {
    if (Object.keys(narratives).length > 0) return 4;
    if (loadingAudience) return 3;
    if (normalized) return 2;
    if (rawInput.trim()) return 1;
    return 0;
  }, [rawInput, normalized, narratives, loadingAudience]);

  const resetDownstream = useCallback(() => {
    setNormalized(null);
    setNarratives({});
    setParseError("");
  }, []);

  const handleLoadSample = useCallback(() => {
    setRawInput(SAMPLE_JUNIT);
    setFileError("");
    resetDownstream();
  }, [resetDownstream]);

  const handleClear = useCallback(() => {
    setRawInput("");
    setFileError("");
    resetDownstream();
  }, [resetDownstream]);

  const readFile = useCallback(
    async (file) => {
      setFileError("");
      const okType = /\.(xml|json|txt)$/i.test(file.name);
      if (!okType) {
        setFileError("Unsupported file type — expected .xml, .json, or .txt.");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setFileError("File is larger than 5 MB.");
        return;
      }
      try {
        const text = await file.text();
        setRawInput(text);
        resetDownstream();
      } catch {
        setFileError("Could not read that file.");
      }
    },
    [resetDownstream]
  );

  const handleFilePick = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      if (file) readFile(file);
      e.target.value = "";
    },
    [readFile]
  );

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files?.[0];
      if (file) readFile(file);
    },
    [readFile]
  );

  const handleParse = useCallback(() => {
    try {
      const result = parseReport(rawInput);
      setNormalized(result);
      setNarratives({});
      setParseError("");
    } catch (e) {
      setParseError(e.message || "Could not parse this report.");
      setNormalized(null);
    }
  }, [rawInput]);

  const handleGenerate = useCallback(
    async (audienceKey) => {
      if (!normalized || !rawInput.trim()) return;
      setLoadingAudience(audienceKey);
      setGenerationError((prev) => {
        const next = { ...prev };
        delete next[audienceKey];
        return next;
      });
      try {
        const result = await generateNarrative(audienceKey, rawInput, config);
        setNarratives((prev) => ({ ...prev, [audienceKey]: result }));
      } catch (e) {
        setNarratives((prev) => {
          const next = { ...prev };
          delete next[audienceKey];
          return next;
        });
        setGenerationError((prev) => ({ ...prev, [audienceKey]: e.message || "Generation failed." }));
      } finally {
        setLoadingAudience(null);
      }
    },
    [normalized, rawInput, config]
  );

  const handleCopy = useCallback((key, text) => {
    navigator.clipboard?.writeText(text || "");
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(""), 1500);
  }, []);

  const handleDownload = useCallback(
    (audience, text) => {
      const status = normalized ? normalized.ragLabel.replace(/\s+/g, "-") : "report";
      const name = `${audience.label.replace(/\s+/g, "-")}_${status}.md`.toLowerCase();
      const blob = new Blob([text], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    },
    [normalized]
  );

  const active = AUDIENCES.find((a) => a.key === activeAudience) || AUDIENCES[0];
  const activeNarrative = narratives[activeAudience];
  const activeError = generationError[activeAudience];
  const isLoading = loadingAudience === activeAudience;

  const providerHealth = health?.providers?.[config.provider];
  const isReady =
    config.auth === "api" ? Boolean(config.apiKey?.trim()) : Boolean(providerHealth?.cli);
  const initial = (user?.name || user?.email || "?").charAt(0).toUpperCase();
  const connectionName =
    config.auth === "api"
      ? "Claude API"
      : config.execution === "agentic"
        ? "MCP / Claude CLI"
        : "Claude CLI";
  const connectionDetail =
    health === null
      ? "Checking connection..."
      : isReady
        ? `${connectionName} connected`
        : config.auth === "api"
          ? "API key required"
          : "Claude CLI unavailable";

  return (
    <div className="app">
      <header className="app__header">
        <div className="brand">
          <span className="brand__logo-frame">
            <img className="brand__logo" src="/logo.png" alt="" width="44" height="44" />
          </span>
          <div>
            <h1 className="brand__title">Stakeholder Translator (QEA)</h1>
            <p className="brand__sub">
              Test-run reports, told the way each audience needs to hear them.
            </p>
          </div>
        </div>
        <div className="app__header-actions">
          <div className="account-menu-wrap" ref={menuRef}>
            <button
              className="account-trigger"
              type="button"
              aria-haspopup="true"
              aria-expanded={showMenu}
              aria-controls="account-menu"
              onClick={() => setShowMenu((open) => !open)}
            >
              {user?.picture ? (
                <img
                  className="user__avatar"
                  src={user.picture}
                  alt=""
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="user__avatar user__avatar--initial" aria-hidden="true">
                  {initial}
                </span>
              )}
              <span className="account-trigger__copy">
                <span className="account-trigger__name">{user?.name || "Account"}</span>
                <span className={`account-trigger__status ${isReady ? "is-ready" : ""}`}>
                  {health === null ? "Checking" : isReady ? "Connected" : "Action needed"}
                </span>
              </span>
              <svg
                className={`account-trigger__chevron ${showMenu ? "is-open" : ""}`}
                width="16"
                height="16"
                viewBox="0 0 16 16"
                aria-hidden="true"
              >
                <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </button>

            {showMenu && (
              <div className="account-menu" id="account-menu" aria-label="Account and connection menu">
                <div className="account-menu__heading">Workspace</div>

                <div className="account-menu__info">
                  <span
                    className={`connection-dot ${
                      health === null ? "is-checking" : isReady ? "is-ready" : "is-offline"
                    }`}
                    aria-hidden="true"
                  />
                  <span>
                    <span className="account-menu__label">API / MCP CLI status</span>
                    <span className="account-menu__value">{connectionDetail}</span>
                  </span>
                </div>

                <div className="account-menu__info">
                  <span className="account-menu__icon" aria-hidden="true">@</span>
                  <span>
                    <span className="account-menu__label">User email ID</span>
                    <span className="account-menu__value">{user?.email || "Not available"}</span>
                  </span>
                </div>

                <div className="account-menu__divider" />

                <button
                  className="account-menu__action"
                  type="button"
                  onClick={() => {
                    setShowMenu(false);
                    setShowSettings(true);
                  }}
                >
                  <span className="account-menu__action-icon" aria-hidden="true">CFG</span>
                  <span>Settings</span>
                </button>

                {onSignOut && (
                  <button
                    className="account-menu__action account-menu__action--danger"
                    type="button"
                    onClick={() => {
                      setShowMenu(false);
                      onSignOut();
                    }}
                  >
                    <span className="account-menu__action-icon" aria-hidden="true">EXIT</span>
                    <span>Sign Out</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="app__body">
        <PipelineRail stageIndex={stageIndex} />

        <main className="content">
          {/* Ingest & Normalize */}
          <section className="card">
            <div className="card__head">
              <h2 className="card__eyebrow">1 · 2 — Ingest &amp; Normalize</h2>
              <div className="card__head-actions">
                <button className="btn btn--soft btn--sm" onClick={handleLoadSample}>
                  Load sample
                </button>
                <button
                  className="btn btn--soft btn--sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Upload file
                </button>
                {rawInput && (
                  <button className="btn btn--ghost btn--sm" onClick={handleClear}>
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div
              className={`dropzone ${dragActive ? "dropzone--active" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
            >
              <textarea
                className="dropzone__input"
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
                placeholder="Paste JUnit / TestNG XML or a suites-shaped JSON report here — or drop a .xml / .json file."
                spellCheck={false}
              />
              {!rawInput && (
                <div className="dropzone__hint" aria-hidden="true">
                  Drag &amp; drop a report file, or paste above
                </div>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".xml,.json,.txt,application/xml,application/json,text/plain"
              onChange={handleFilePick}
              hidden
            />

            <div className="card__foot">
              <button className="btn btn--primary" onClick={handleParse} disabled={!rawInput.trim()}>
                Parse report
              </button>
              {fileError && <span className="status status--bad">{fileError}</span>}
              {parseError && <span className="status status--bad">{parseError}</span>}
              {normalized && !parseError && (
                <span className="status status--good">
                  Parsed {normalized.totalTests} tests across {normalized.suites.length} suites.
                </span>
              )}
            </div>
          </section>

          {/* Frame */}
          {normalized && (
            <section className="card">
              <div className="card__head">
                <h2 className="card__eyebrow">3 — Frame · grounded, nothing invented</h2>
                <RagBadge rag={normalized.rag} label={normalized.ragLabel} />
              </div>

              <div className="tiles">
                <StatTile label="Total" value={normalized.totalTests} />
                <StatTile label="Passed" value={normalized.passed} tone="good" />
                <StatTile label="Failed" value={normalized.failed} tone="bad" />
                <StatTile label="Skipped" value={normalized.skipped} tone="muted" />
                <StatTile label="Pass rate" value={`${normalized.passRatePct}%`} />
                <StatTile label="Duration" value={`${normalized.durationSec}s`} />
              </div>

              <div className="suites">
                {normalized.suites.map((s) => (
                  <SuiteMeter key={s.name} suite={s} />
                ))}
              </div>

              {normalized.failures.length > 0 && (
                <div className="failures">
                  <h3 className="failures__title">Failures ({normalized.failures.length})</h3>
                  <ul className="failures__list">
                    {normalized.failures.map((f, i) => (
                      <li key={i} className="failure">
                        <span
                          className={`impact ${
                            f.highImpact ? "impact--high" : "impact--low"
                          }`}
                        >
                          {f.highImpact ? "High impact" : "Low impact"}
                        </span>
                        <span className="failure__body">
                          <strong>{f.suite}</strong> — {f.test}: {f.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          {/* Generate & Present */}
          {normalized && (
            <section className="card">
              <div className="card__head">
                <h2 className="card__eyebrow">4 · 5 — Generate &amp; Present</h2>
              </div>

              <div className="tabs" role="tablist" aria-label="Audience">
                {AUDIENCES.map((a) => (
                  <button
                    key={a.key}
                    role="tab"
                    aria-selected={activeAudience === a.key}
                    className={`tab ${activeAudience === a.key ? "tab--active" : ""}`}
                    onClick={() => setActiveAudience(a.key)}
                  >
                    {a.label}
                  </button>
                ))}
              </div>

              <p className="tab__blurb">{active.blurb}</p>

              <ExecutionConfig config={config} onChange={setConfig} health={health} />

              <div className="narrative">
                {activeError && !isLoading && (
                  <p className="status status--bad" style={{ marginBottom: 12 }}>
                    {activeError}
                  </p>
                )}

                {!activeNarrative && !isLoading && (
                  <div className="narrative__empty">
                    <p className="status status--muted">
                      {activeError ? "Fix the issue above and try again." : "No narrative generated yet for this audience."}
                    </p>
                    <button
                      className="btn btn--primary"
                      onClick={() => handleGenerate(activeAudience)}
                      disabled={config.auth === "api" && !config.apiKey?.trim()}
                    >
                      Translate
                    </button>
                  </div>
                )}

                {isLoading && (
                  <p className="narrative__loading">
                    Writing the {active.label.toLowerCase()} narrative…
                  </p>
                )}

                {activeNarrative && !isLoading && (
                  <div>
                    <pre className="narrative__text">{activeNarrative.text}</pre>

                    {activeNarrative.note && (
                      <p className="status status--warn narrative__note">{activeNarrative.note}</p>
                    )}

                    <div className="narrative__actions">
                      <span
                        className={`source source--${activeNarrative.source.startsWith("claude") ? "claude" : "local"}`}
                        title={activeNarrative.source}
                      >
                        {formatSourceLabel(activeNarrative.source)}
                      </span>
                      <button
                        className="btn btn--soft btn--sm"
                        onClick={() => handleGenerate(activeAudience)}
                      >
                        Regenerate
                      </button>
                      <button
                        className="btn btn--soft btn--sm"
                        onClick={() => handleCopy(activeAudience, activeNarrative.text)}
                      >
                        {copiedKey === activeAudience ? "Copied ✓" : "Copy"}
                      </button>
                      <button
                        className="btn btn--soft btn--sm"
                        onClick={() => handleDownload(active, activeNarrative.text)}
                      >
                        Download
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          <p className="footnote">
            Prototype: parsing runs entirely in this page for the summary above. When you click
            Translate, the raw report is sent once to the backend, which parses it again into its
            own store and — in Agentic mode — lets the model call real MCP tools against that
            store (getSummary, getRiskAnalysis, listFailedTests, etc.) rather than being handed a
            wall of text. Standard mode skips the tools and sends the report context directly, for
            comparison. Nothing here fabricates a narrative: if the CLI isn't installed, the key is
            invalid, or the MCP connection fails, you'll see that error instead of invented text.
          </p>
        </main>
      </div>

      {showSettings && (
        <SettingsDialog
          config={config}
          onSave={(next) => {
            setConfig((prev) => ({ ...prev, ...next }));
            setShowSettings(false);
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

/* ---------- Settings dialog (advanced: backend location only) ---------- */

function SettingsDialog({ config, onSave, onClose }) {
  const [backendUrl, setBackendUrl] = useState(config.backendUrl || DEFAULT_BACKEND_URL);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState(null); // null | "ok" | "fail"

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleTest = async () => {
    setChecking(true);
    setCheckResult(null);
    try {
      const res = await fetch(`${backendUrl.replace(/\/$/, "")}/api/health`);
      const data = await res.json();
      setCheckResult(data.ok ? "ok" : "fail");
    } catch {
      setCheckResult("fail");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog__head">
          <h2 className="dialog__title">Settings</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <label className="field">
          <span className="field__label">Backend URL</span>
          <input
            className="field__input"
            type="text"
            value={backendUrl}
            onChange={(e) => setBackendUrl(e.target.value)}
            placeholder={DEFAULT_BACKEND_URL}
            autoComplete="off"
            spellCheck={false}
          />
          <span className="field__hint">
            Only change this if the backend is running on a different host or port. Provider,
            execution mode, and API key live in the panel above the Translate button.
          </span>
        </label>

        <div className="field">
          <button className="btn btn--soft btn--sm" onClick={handleTest} disabled={checking}>
            {checking ? "Checking…" : "Test connection"}
          </button>
          {checkResult === "ok" && (
            <span className="status status--good" style={{ marginLeft: 10 }}>
              Backend reachable ✓
            </span>
          )}
          {checkResult === "fail" && (
            <span className="status status--bad" style={{ marginLeft: 10 }}>
              Couldn't reach the backend — is it running?
            </span>
          )}
        </div>

        <div className="dialog__foot">
          <button className="btn btn--soft btn--sm" onClick={() => setBackendUrl(DEFAULT_BACKEND_URL)}>
            Reset to default
          </button>
          <div className="dialog__foot-right">
            <button className="btn btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn--primary" onClick={() => onSave({ backendUrl })}>
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
