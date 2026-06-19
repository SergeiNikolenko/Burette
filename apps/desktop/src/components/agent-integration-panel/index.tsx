import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { isTauriRuntime } from "../../lib/tauri";
import { EditorScrollContainer } from "../editor-area/editor-scroll-container";

type AgentIntegrationCheck = {
  id: string;
  label: string;
  state: "ok" | "missing" | string;
  detail: string;
};

type AgentIntegrationStatus = {
  schema: "burette_agent_integration.v1";
  state: "ready" | "install_available" | "update_available" | "broken" | string;
  appVersion: string;
  bundledPlugin: {
    state: "ready" | "missing" | "broken" | string;
    name: string;
    version: string | null;
    path: string | null;
    displayName: string | null;
    compatibility: {
      app: string | null;
      agentCli: string | null;
      controlApi: string | null;
    } | null;
  };
  codexInstall: {
    state: "current" | "not_installed" | "update_available" | "unknown" | string;
    version: string | null;
    path: string | null;
    message: string;
  };
  checks: AgentIntegrationCheck[];
};

const initialStatus: AgentIntegrationStatus | null = null;

export function AgentIntegrationPanel({ embedded = false }: { embedded?: boolean }) {
  const [status, setStatus] = useState<AgentIntegrationStatus | null>(initialStatus);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      if (!isTauriRuntime()) {
        setStatus(browserPreviewStatus);
        return;
      }
      const next = await invoke<AgentIntegrationStatus>("agent_integration_status");
      setStatus(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openBundle = useCallback(async () => {
    if (!status?.bundledPlugin.path) return;
    await openPath(status.bundledPlugin.path);
  }, [status?.bundledPlugin.path]);

  const copyBundlePath = useCallback(async () => {
    if (!status?.bundledPlugin.path) return;
    await navigator.clipboard.writeText(status.bundledPlugin.path);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }, [status?.bundledPlugin.path]);

  const setupPrompt = codexSetupPrompt(status);
  const copySetupPrompt = useCallback(async () => {
    await navigator.clipboard.writeText(setupPrompt);
    setPromptCopied(true);
    window.setTimeout(() => setPromptCopied(false), 1400);
  }, [setupPrompt]);

  const actionLabel = codexActionLabel(status?.codexInstall.state);
  const content = (
    <div className="agent-integration-content">
      <div className="agent-integration-header">
        <div>
          <h1>Burrete</h1>
          <p>{statusLine(status, error)}</p>
        </div>
        <div className="agent-integration-actions">
          <button type="button" className="settings-action-button" onClick={() => void refresh()} disabled={refreshing}>
            {refreshing ? "Checking..." : "Refresh"}
          </button>
          <button type="button" className="settings-action-button" onClick={() => void openBundle()} disabled={!status?.bundledPlugin.path}>
            {actionLabel}
          </button>
          <button type="button" className="settings-action-button" onClick={() => void copyBundlePath()} disabled={!status?.bundledPlugin.path}>
            {copied ? "Copied" : "Copy Path"}
          </button>
        </div>
      </div>

      <section className="agent-integration-section" aria-label="Plugin status">
        <h2>Status</h2>
        <div className="settings-card">
          <StatusRow label="Bundle" value={bundleSummary(status)} state={status?.bundledPlugin.state ?? "unknown"} />
          <StatusRow label="Codex" value={codexSummary(status)} state={status?.codexInstall.state ?? "unknown"} />
          <StatusRow label="App" value={appSummary(status)} state="ok" />
        </div>
      </section>

      <section className="agent-integration-section" aria-label="Codex setup prompt">
        <h2>Codex setup prompt</h2>
        <div className="settings-card">
          <div className="agent-setup-prompt">
            <pre>{setupPrompt}</pre>
            <div className="agent-setup-prompt-footer">
              <span>Paste this into Codex if automatic install is unavailable.</span>
              <button type="button" className="settings-action-button" onClick={() => void copySetupPrompt()}>
                {promptCopied ? "Copied" : "Copy Prompt"}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="agent-integration-section" aria-label="Compatibility">
        <h2>Compatibility</h2>
        <div className="settings-card">
          <StatusRow label="Burrete" value={status?.bundledPlugin.compatibility?.app ?? "Not declared"} state={status?.bundledPlugin.compatibility?.app ? "ok" : "missing"} />
          <StatusRow label="CLI" value={status?.bundledPlugin.compatibility?.agentCli ?? "Not declared"} state={status?.bundledPlugin.compatibility?.agentCli ? "ok" : "missing"} />
          <StatusRow label="Control API" value={status?.bundledPlugin.compatibility?.controlApi ?? "Not declared"} state={status?.bundledPlugin.compatibility?.controlApi ? "ok" : "missing"} />
        </div>
      </section>

      <section className="agent-integration-section" aria-label="Readiness checks">
        <h2>Checks</h2>
        <div className="settings-card">
          {(status?.checks ?? []).map((check) => (
            <StatusRow key={check.id} label={check.label} value={check.detail} state={check.state} />
          ))}
          {!status && !error ? <StatusRow label="Checks" value="Waiting for status." state="unknown" /> : null}
          {error ? <StatusRow label="Error" value={error} state="missing" /> : null}
        </div>
      </section>
    </div>
  );

  return (
    <div className="agent-integration-panel" data-agent-integration-panel data-embedded={embedded || undefined}>
      {embedded ? content : <EditorScrollContainer>{content}</EditorScrollContainer>}
    </div>
  );
}

const browserPreviewStatus: AgentIntegrationStatus = {
  schema: "burette_agent_integration.v1",
  state: "ready",
  appVersion: "browser-dev",
  bundledPlugin: {
    state: "ready",
    name: "burrete",
    version: "0.1.0",
    path: browserPreviewPluginPath(),
    displayName: "Burrete",
    compatibility: {
      app: "desktop runtime",
      agentCli: "structured CLI contract",
      controlApi: "Burrete Control API",
    },
  },
  codexInstall: {
    state: "unknown",
    version: null,
    path: null,
    message: "Open the packaged app to inspect the local Codex plugin installation.",
  },
  checks: [
    {
      id: "browser-preview",
      label: "Browser preview",
      state: "ok",
      detail: "Settings UI is running in browser preview; native install checks are available in the desktop app.",
    },
  ],
};

function StatusRow({ label, value, state }: { label: string; value: string; state: string }) {
  return (
    <div className="agent-status-row">
      <div className="agent-status-copy">
        <div className="settings-control-label">{label}</div>
        <div className="settings-control-description">{value}</div>
      </div>
      <span className="agent-status-badge" data-state={badgeState(state)}>
        {badgeLabel(state)}
      </span>
    </div>
  );
}

function statusLine(status: AgentIntegrationStatus | null, error: string | null) {
  if (error) return "Integration status could not be read.";
  if (!status) return "Checking local integration.";
  if (status.state === "update_available") return "A different Burrete plugin version is installed in Codex.";
  if (status.state === "install_available") return "Burrete is bundled and ready to install in Codex.";
  if (status.state === "broken") return "The bundled plugin is incomplete.";
  return "Burrete is ready.";
}

function bundleSummary(status: AgentIntegrationStatus | null) {
  if (!status) return "Checking bundled plugin.";
  const version = status.bundledPlugin.version ? `v${status.bundledPlugin.version}` : "version unknown";
  if (status.bundledPlugin.state === "missing") return "Bundle not found.";
  return `${version} bundled with Burrete.`;
}

function codexSummary(status: AgentIntegrationStatus | null) {
  if (!status) return "Checking Codex cache.";
  if (status.codexInstall.version) return `${status.codexInstall.message} Installed v${status.codexInstall.version}.`;
  return status.codexInstall.message;
}

function codexSetupPrompt(status: AgentIntegrationStatus | null) {
  const version = status?.bundledPlugin.version ?? "0.1.0";
  return [
    `Install or update the local Codex plugin @Burrete (id \`burrete\`) to version ${version}.`,
    "Use the bundled plugin directory `plugins/burette-agent` from the current Burrete repository or app bundle.",
    "If Codex cannot resolve that relative path, ask for the explicit bundle path from Burrete.",
    "After installation, verify @Burrete is available in Codex, its skills load, and its MCP server is registered.",
  ].join("\n");
}

function browserPreviewPluginPath() {
  const repoRoot = String(import.meta.env.BURRETE_REPO_ROOT || "").trim().replace(/\/+$/u, "");
  return repoRoot ? `${repoRoot}/plugins/burette-agent` : null;
}

function appSummary(status: AgentIntegrationStatus | null) {
  if (!status) return "Checking app version.";
  return `Burrete v${status.appVersion}`;
}

function codexActionLabel(state: string | undefined) {
  if (state === "update_available") return "Open Update";
  if (state === "current") return "Open Bundle";
  return "Open Install";
}

function badgeState(state: string) {
  if (state === "ok" || state === "ready" || state === "current") return "ok";
  if (state === "missing" || state === "broken") return "missing";
  if (state === "update_available" || state === "not_installed" || state === "install_available") return "action";
  return "unknown";
}

function badgeLabel(state: string) {
  if (state === "ok") return "OK";
  if (state === "ready") return "Ready";
  if (state === "current") return "Current";
  if (state === "update_available") return "Update";
  if (state === "not_installed" || state === "install_available") return "Install";
  if (state === "missing") return "Missing";
  if (state === "broken") return "Broken";
  return "Unknown";
}
