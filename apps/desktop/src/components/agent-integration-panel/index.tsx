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

  const summary = integrationSummary(status, error);
  const content = (
    <div className="agent-integration-content">
      <header className="agent-integration-header">
        <div>
          <h1>Codex Agent</h1>
          <p>Status for the bundled plugin used by Codex MCP tools.</p>
        </div>
        <div className="agent-integration-actions">
          <button type="button" className="settings-action-button" onClick={() => void refresh()} disabled={refreshing}>
            {refreshing ? "Checking..." : "Refresh"}
          </button>
          <button type="button" className="settings-action-button" onClick={() => void openBundle()} disabled={!status?.bundledPlugin.path}>
            Reveal Bundle
          </button>
        </div>
      </header>

      <section className="agent-summary-section" aria-label="Agent status">
        <div className="agent-summary-card" data-state={badgeState(summary.state)}>
          <div className="agent-summary-copy">
            <div className="agent-summary-kicker">Agent integration</div>
            <h2>{summary.title}</h2>
            <p>{summary.detail}</p>
          </div>
          <span className="agent-status-badge" data-state={badgeState(summary.state)}>
            {badgeLabel(summary.state)}
          </span>
        </div>
      </section>

      <section className="agent-integration-section" aria-label="Connection status">
        <h2>Connection</h2>
        <div className="settings-card">
          <StatusRow label="Codex plugin" value={codexSummary(status)} state={status?.codexInstall.state ?? "unknown"} />
          <StatusRow label="MCP server" value={checkSummary(status, "mcp", "MCP server entry point is bundled.")} state={checkState(status, "mcp")} />
          <StatusRow label="Browser shell" value={checkSummary(status, "browser-shell", "Browser shell assets are bundled.")} state={checkState(status, "browser-shell")} />
          <StatusRow label="Skills and widgets" value={skillsAndWidgetsSummary(status)} state={combinedCheckState(status, ["skills", "widgets"])} />
        </div>
      </section>

      <details className="agent-disclosure">
        <summary>
          <span className="agent-disclosure-copy">
            <span className="agent-disclosure-title">Manual setup</span>
            <span className="agent-disclosure-description">Copy a fallback prompt or inspect the bundled plugin path.</span>
          </span>
        </summary>
        <div className="agent-disclosure-body">
          <div className="agent-setup-prompt">
            <pre>{setupPrompt}</pre>
            <div className="agent-setup-prompt-footer">
              <span>Use this only if automatic app-update sync is unavailable.</span>
              <div className="agent-setup-prompt-actions">
                <button type="button" className="settings-action-button" onClick={() => void copySetupPrompt()}>
                  {promptCopied ? "Copied" : "Copy Prompt"}
                </button>
                <button type="button" className="settings-action-button" onClick={() => void copyBundlePath()} disabled={!status?.bundledPlugin.path}>
                  {copied ? "Copied" : "Copy Bundle Path"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </details>

      <details className="agent-disclosure">
        <summary>
          <span className="agent-disclosure-copy">
            <span className="agent-disclosure-title">Diagnostics</span>
            <span className="agent-disclosure-description">Bundle compatibility and file-level readiness checks.</span>
          </span>
        </summary>
        <div className="agent-disclosure-body">
          <div className="agent-diagnostic-group">
            <h3>Bundle</h3>
            <StatusRow label="Bundle" value={bundleSummary(status)} state={status?.bundledPlugin.state ?? "unknown"} />
            <StatusRow label="App" value={appSummary(status)} state="ok" />
          </div>
          <div className="agent-diagnostic-group">
            <h3>Compatibility</h3>
            <StatusRow label="Burrete" value={status?.bundledPlugin.compatibility?.app ?? "Not declared"} state={status?.bundledPlugin.compatibility?.app ? "ok" : "missing"} />
            <StatusRow label="CLI" value={status?.bundledPlugin.compatibility?.agentCli ?? "Not declared"} state={status?.bundledPlugin.compatibility?.agentCli ? "ok" : "missing"} />
            <StatusRow label="Control API" value={status?.bundledPlugin.compatibility?.controlApi ?? "Not declared"} state={status?.bundledPlugin.compatibility?.controlApi ? "ok" : "missing"} />
          </div>
          <div className="agent-diagnostic-group">
            <h3>Readiness checks</h3>
            {(status?.checks ?? []).map((check) => (
              <StatusRow key={check.id} label={check.label} value={check.detail} state={check.state} />
            ))}
            {!status && !error ? <StatusRow label="Checks" value="Waiting for status." state="unknown" /> : null}
            {error ? <StatusRow label="Error" value={error} state="missing" /> : null}
          </div>
        </div>
      </details>
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

function integrationSummary(status: AgentIntegrationStatus | null, error: string | null) {
  if (error) {
    return {
      title: "Status unavailable",
      detail: "Burrete could not read the local Codex agent integration.",
      state: "missing",
    };
  }
  if (!status) {
    return {
      title: "Checking agent status",
      detail: "Burrete is inspecting the bundled plugin and local Codex cache.",
      state: "unknown",
    };
  }
  if (status.state === "update_available") {
    return {
      title: "Codex plugin needs an update",
      detail: "The app bundle contains a different plugin version than the one currently installed in Codex.",
      state: status.state,
    };
  }
  if (status.state === "install_available") {
    return {
      title: "Codex plugin is not installed",
      detail: "Burrete includes the plugin bundle; app updates can sync it into the local Codex cache.",
      state: status.state,
    };
  }
  if (status.state === "broken") {
    return {
      title: "Bundled plugin is incomplete",
      detail: "One or more required plugin files are missing from this Burrete bundle.",
      state: status.state,
    };
  }
  return {
    title: "Codex agent is ready",
    detail: "Codex can use the Burrete MCP server, skills, widgets, and Browser shell assets from this app bundle.",
    state: status.state,
  };
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

function checkSummary(status: AgentIntegrationStatus | null, id: string, readyText: string) {
  if (!status) return "Waiting for status.";
  const check = findCheck(status, id);
  if (!check) return "Open the packaged app to inspect this check.";
  return check.state === "ok" ? readyText : check.detail;
}

function checkState(status: AgentIntegrationStatus | null, id: string) {
  return findCheck(status, id)?.state ?? "unknown";
}

function skillsAndWidgetsSummary(status: AgentIntegrationStatus | null) {
  if (!status) return "Waiting for status.";
  const checks = ["skills", "widgets"].map((id) => findCheck(status, id)).filter((check): check is AgentIntegrationCheck => !!check);
  if (checks.length === 0) return "Open the packaged app to inspect skills and widget assets.";
  const missing = checks.filter((check) => badgeState(check.state) === "missing").map((check) => check.label);
  if (missing.length > 0) return `Missing ${missing.join(" and ").toLowerCase()}.`;
  return "Skills and widget assets are bundled.";
}

function combinedCheckState(status: AgentIntegrationStatus | null, ids: string[]) {
  if (!status) return "unknown";
  const checks = ids.map((id) => findCheck(status, id)).filter((check): check is AgentIntegrationCheck => !!check);
  if (checks.length === 0) return "unknown";
  if (checks.some((check) => badgeState(check.state) === "missing")) return "missing";
  if (checks.some((check) => badgeState(check.state) === "action")) return "action";
  if (checks.every((check) => badgeState(check.state) === "ok")) return "ok";
  return "unknown";
}

function findCheck(status: AgentIntegrationStatus | null, id: string) {
  return status?.checks.find((check) => check.id === id) ?? null;
}

function codexSetupPrompt(status: AgentIntegrationStatus | null) {
  const version = status?.bundledPlugin.version ?? "0.1.0";
  const pluginPath = status?.bundledPlugin.path ?? "plugins/burette-agent";
  return [
    `Install or update the local Codex plugin @Burrete (id \`burrete\`) to version ${version}.`,
    `Use the bundled plugin directory \`${pluginPath}\`.`,
    "Install it with `bun run install:plugin`. On a fresh machine the marketplace name defaults to `burrete`, so the plugin id is `burrete@burrete`. If a local marketplace already exists, the installer keeps that marketplace name unless `BURRETE_PLUGIN_MARKETPLACE=burrete` is set.",
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
