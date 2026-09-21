import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { isTauriRuntime } from "../../lib/tauri";
import { EditorScrollContainer } from "../editor-area/editor-scroll-container";

type AgentIntegrationCheck = {
  id: string;
  label: string;
  state: "ok" | "missing" | string;
  detail: string;
};

type AgentInstallStatus = {
  id: string;
  label: string;
  state: "current" | "not_installed" | "update_available" | "unknown" | string;
  version: string | null;
  path: string | null;
  message: string;
};

type AgentIntegrationStatus = {
  schema: "burette_agent_integration.v2";
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
  agentInstalls: AgentInstallStatus[];
  checks: AgentIntegrationCheck[];
};

const initialStatus: AgentIntegrationStatus | null = null;

export function AgentIntegrationPanel({ embedded = false }: { embedded?: boolean }) {
  const [status, setStatus] = useState<AgentIntegrationStatus | null>(initialStatus);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      if (!isTauriRuntime()) {
        const response = await fetch("/__burette/agent-integration");
        const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
        if (!response.ok || !isJson) {
          // Static shells (for example the packaged browser agent shell) do
          // not serve the status endpoint; report that instead of erroring.
          setStatus(unservedSurfaceStatus);
          return;
        }
        setStatus((await response.json()) as AgentIntegrationStatus);
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

  const summary = integrationSummary(status, error);
  const content = (
    <div className="agent-integration-content">
      <header className="agent-integration-header">
        <div>
          <h1>Agents</h1>
          <p>Status for the bundled Burette agent plugin and local agent installs.</p>
        </div>
        <div className="agent-integration-actions">
          <Button type="button" variant="secondary" size="sm" onClick={() => void refresh()} disabled={refreshing}>
            {refreshing ? "Checking..." : "Refresh"}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => void openBundle()} disabled={!status?.bundledPlugin.path}>
            Reveal Bundle
          </Button>
        </div>
      </header>

      <section className="agent-summary-section" aria-label="Agent status">
        <div className="agent-summary-card" data-state={badgeState(summary.state)}>
          <div className="agent-summary-copy">
            <div className="agent-summary-kicker">Agent integration</div>
            <h2>{summary.title}</h2>
            <p>{summary.detail}</p>
          </div>
          <StatusBadge state={summary.state} />
        </div>
      </section>

      <section className="agent-integration-section" aria-label="Connection status">
        <h2>Connection</h2>
        <div className="settings-card">
          {(status?.agentInstalls ?? []).map((agent) => (
            <StatusRow key={agent.id} label={`${agent.label} plugin`} value={agentSummary(agent)} state={agent.state} />
          ))}
          {!status ? <StatusRow label="Agent plugins" value="Checking local agent installs." state="unknown" /> : null}
          <StatusRow label="MCP server" value={checkSummary(status, "mcp", "MCP server entry point is bundled.")} state={checkState(status, "mcp")} />
          <StatusRow label="Browser shell" value={checkSummary(status, "browser-shell", "Browser shell assets are bundled.")} state={checkState(status, "browser-shell")} />
          <StatusRow label="Skills" value={checkSummary(status, "skills", "Workflow skills are bundled.")} state={checkState(status, "skills")} />
        </div>
      </section>

      <Collapsible className="agent-disclosure">
        <CollapsibleTrigger className="agent-disclosure-trigger">
          <span className="agent-disclosure-copy">
            <span className="agent-disclosure-title">Diagnostics</span>
            <span className="agent-disclosure-description">Bundle compatibility and file-level readiness checks.</span>
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="agent-disclosure-body">
          <div className="agent-diagnostic-group">
            <h3>Bundle</h3>
            <StatusRow label="Bundle" value={bundleSummary(status)} state={status?.bundledPlugin.state ?? "unknown"} />
            <StatusRow label="App" value={appSummary(status)} state="ok" />
          </div>
          <div className="agent-diagnostic-group">
            <h3>Compatibility</h3>
            <StatusRow label="Burette" value={status?.bundledPlugin.compatibility?.app ?? "Not declared"} state={status?.bundledPlugin.compatibility?.app ? "ok" : "missing"} />
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
        </CollapsibleContent>
      </Collapsible>
    </div>
  );

  return (
    <div className="agent-integration-panel" data-agent-integration-panel data-embedded={embedded || undefined}>
      {embedded ? content : <EditorScrollContainer>{content}</EditorScrollContainer>}
    </div>
  );
}

const unservedSurfaceStatus: AgentIntegrationStatus = {
  schema: "burette_agent_integration.v2",
  state: "ready",
  appVersion: "browser shell",
  bundledPlugin: {
    state: "ready",
    name: "burette",
    version: null,
    path: null,
    displayName: "Burette",
    compatibility: null,
  },
  agentInstalls: [],
  checks: [
    {
      id: "unserved-surface",
      label: "Status endpoint",
      state: "unknown",
      detail:
        "This surface does not serve agent integration status; open the desktop app or a browser-dev shell for live checks.",
    },
  ],
};

function StatusRow({ label, value, state }: { label: string; value: string; state: string }) {
  return (
    <Item className="agent-status-row" size="sm">
      <ItemContent className="agent-status-copy">
        <ItemTitle className="settings-control-label">{label}</ItemTitle>
        <ItemDescription className="settings-control-description">{value}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <StatusBadge state={state} />
      </ItemActions>
    </Item>
  );
}

// The badge keeps .agent-status-badge and its data-state: the ok/action/missing
// tints are app tokens, not shadcn variants.
function StatusBadge({ state }: { state: string }) {
  return (
    <Badge variant="secondary" className="agent-status-badge" data-state={badgeState(state)}>
      {badgeLabel(state)}
    </Badge>
  );
}

function integrationSummary(status: AgentIntegrationStatus | null, error: string | null) {
  if (error) {
    return {
      title: "Status unavailable",
      detail: "Burette could not read the local agent integration.",
      state: "missing",
    };
  }
  if (!status) {
    return {
      title: "Checking agent status",
      detail: "Burette is inspecting the bundled plugin and local agent installs.",
      state: "unknown",
    };
  }
  if (status.state === "update_available") {
    return {
      title: "An agent plugin needs an update",
      detail: "The app bundle contains a different plugin version than one installed in a local agent.",
      state: status.state,
    };
  }
  if (status.state === "install_available") {
    return {
      title: "The agent plugin is not installed",
      detail: "Burette includes the plugin bundle; run the repository's bun run install:plugin to install it into Codex.",
      state: status.state,
    };
  }
  if (status.state === "broken") {
    return {
      title: "Bundled plugin is incomplete",
      detail: "One or more required plugin files are missing from this Burette bundle.",
      state: status.state,
    };
  }
  return {
    title: "Agent plugin is ready",
    detail: "Agents can use the Burette MCP server, skills, and Browser shell assets from this app bundle.",
    state: status.state,
  };
}

function bundleSummary(status: AgentIntegrationStatus | null) {
  if (!status) return "Checking bundled plugin.";
  const version = status.bundledPlugin.version ? `v${status.bundledPlugin.version}` : "version unknown";
  if (status.bundledPlugin.state === "missing") return "Bundle not found.";
  return `${version} bundled with Burette.`;
}

function agentSummary(agent: AgentInstallStatus) {
  if (agent.version) return `${agent.message} Installed v${agent.version}.`;
  return agent.message;
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

function findCheck(status: AgentIntegrationStatus | null, id: string) {
  return status?.checks.find((check) => check.id === id) ?? null;
}

function appSummary(status: AgentIntegrationStatus | null) {
  if (!status) return "Checking app version.";
  return `Burette v${status.appVersion}`;
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
  if (state === "not_installed") return "Not installed";
  if (state === "install_available") return "Install";
  if (state === "missing") return "Missing";
  if (state === "broken") return "Broken";
  return "Unknown";
}
