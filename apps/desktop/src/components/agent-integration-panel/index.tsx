import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronRight } from "@/components/ui/app-icons";
import { Spinner } from "@/components/ui/spinner";
import { SettingsSection, type SettingRow } from "../settings-panel/setting-control";
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

export function AgentIntegrationPanel({ embedded = false }: { embedded?: boolean }) {
  const [status, setStatus] = useState<AgentIntegrationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [revealError, setRevealError] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    setRevealError(false);
    try {
      if (!isTauriRuntime()) {
        const response = await fetch("/__burette/agent-integration");
        const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
        if (!response.ok || !isJson) {
          // Static shells (for example the packaged browser agent shell) do
          // not serve the status endpoint; report that instead of erroring.
          if (response.ok || response.status === 404) {
            setStatus(unservedSurfaceStatus);
          } else {
            throw new Error(`Status request failed (${response.status})`);
          }
          return;
        }
        setStatus((await response.json()) as AgentIntegrationStatus);
        return;
      }
      const next = await invoke<AgentIntegrationStatus>("agent_integration_status");
      setStatus(next);
    } catch (err) {
      setStatus(null);
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
    setRevealError(false);
    try { await openPath(status.bundledPlugin.path); }
    catch { setRevealError(true); }
  }, [status?.bundledPlugin.path]);

  const statusState = refreshing ? "checking" : error ? "unavailable" : status?.state ?? "unknown";
  const diagnosticRows: SettingRow[] = [
    ...(status && status.state !== "unavailable" ? [{ label: "Bundle", control: <>{status.bundledPlugin.version && <span className="text-xs text-(--color-text-secondary)">v{status.bundledPlugin.version}</span>}<StatusValue state={status.bundledPlugin.state} /></> }] : []),
    ...(status?.appVersion ? [{ label: "App", control: status.appVersion }] : []),
    ...Object.entries(status?.bundledPlugin.compatibility ?? {}).filter(([, value]) => value).map(([key, value]) => ({
      label: key === "app" ? "Burette compatibility" : key === "agentCli" ? "CLI compatibility" : "Control API compatibility",
      control: value,
    })),
    ...(status?.checks ?? []).map(check => ({ label: check.label, description: check.detail, control: <StatusValue state={check.state} /> })),
    ...(status?.agentInstalls ?? []).map(agent => ({ label: agent.label, description: agent.message, control: <StatusValue state={agent.state} /> })),
    ...(error ? [{ label: "Status request", description: error, control: <StatusValue state="unavailable" /> }] : []),
  ];
  const content = (
    <div className="agent-integration-content">
      <header className="agent-integration-header">
        <h1>Agents</h1>
        <div className="agent-integration-actions">
          <Button type="button" variant="secondary" size="xs" onClick={() => void refresh()} disabled={refreshing}>
            {refreshing ? <><Spinner className="size-3" aria-hidden />Checking…</> : "Refresh"}
          </Button>
          {isTauriRuntime() && status?.bundledPlugin.path && (
            <Button type="button" variant="secondary" size="xs" onClick={() => void openBundle()}>Reveal Bundle</Button>
          )}
        </div>
      </header>
      {revealError && <p role="alert" className="mb-4 text-sm text-(--color-text-danger)">Could not reveal the bundle. Try again.</p>}
      <SettingsSection title="Agent integration" rows={[{
        label: "Burette plugin",
        control: <span role="status" aria-live="polite"><StatusValue state={statusState} /></span>,
      }]} />
      {!refreshing && !error && status?.agentInstalls.length ? <SettingsSection title="Connection" rows={status.agentInstalls.map(agent => ({
        label: agent.label,
        control: <><span className="text-xs text-(--color-text-secondary)">{agent.version ? `v${agent.version}` : null}</span><StatusValue state={agent.state} /></>,
      }))} /> : null}
      {!refreshing && !error && status && status.state !== "unavailable" && <SettingsSection title="Components" rows={[
        { id: "mcp", label: "Molecular tools" }, { id: "browser-shell", label: "Browser workspace" }, { id: "skills", label: "Workflows" },
      ].map(({ id, label }) => ({ label, control: <StatusValue state={status.checks.find(check => check.id === id)?.state ?? "unknown"} /> }))} />}
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="group mb-3" disabled={refreshing}>
            <ChevronRight className="size-4 transition-transform duration-150 group-data-[state=open]:rotate-90 motion-reduce:transition-none" aria-hidden />
            Diagnostics
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SettingsSection title="Details" rows={diagnosticRows} />
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

// A missing endpoint is not proof that the plugin is ready.
const unservedSurfaceStatus: AgentIntegrationStatus = {
  schema: "burette_agent_integration.v2",
  state: "unavailable",
  appVersion: "",
  bundledPlugin: { state: "unknown", name: "burette", version: null, path: null, displayName: "Burette", compatibility: null },
  agentInstalls: [],
  checks: [{ id: "unserved-surface", label: "Status", state: "unknown", detail: "Open Burette on your desktop to check agent integration." }],
};

function StatusValue({ state }: { state: string }) {
  const labels: Record<string, string> = {
    checking: "Checking…", ok: "Ready", ready: "Ready", current: "Up to date",
    update_available: "Update available", not_installed: "Not installed", install_available: "Not installed",
    missing: "Missing", broken: "Needs repair", unavailable: "Unavailable",
  };
  const failed = state === "broken" || state === "missing" || state === "unavailable";
  return <span className={`text-sm ${failed ? "text-(--color-text-danger)" : "text-(--color-text-secondary)"}`}>{labels[state] ?? "Not checked"}</span>;
}
