import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { useResourceExtensions } from "../../hooks/use-resource-extensions";
import { CRYSTALS_RESOURCE } from "../../lib/extensions/resource-bundle";
import { createAvogadroCatalog } from "../../lib/extensions/avogadro-catalog";
import { pluginLinkUrl, type AvogadroPlugin, type AvogadroPluginLink } from "../../lib/extensions/avogadro-plugin-index";
import { avogadroPluginRunner, type createAvogadroPluginRunner } from "../../lib/extensions/avogadro-plugin-runner";
import { pluginRowParts } from "./avogadro-plugin-controls";
import { isTauriRuntime } from "../../lib/tauri";
import { Button } from "../ui/button";
import { DotsHorizontal } from "../ui/app-icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import type { ShellActions } from "../types";
import { CrystalsBrowser } from "./crystals-browser";
import { AvogadroPluginsSection } from "./avogadro-plugins-section";
import { SettingsSection, type SettingRow } from "./setting-control";

export type ExtensionsSectionProps = {
  extensions: ReturnType<typeof useResourceExtensions> & Pick<ShellActions, "openCrystalsStructure">;
  catalog?: ReturnType<typeof createAvogadroCatalog>;
  /** Avogadro package installs; the desktop shell provides them by default. */
  plugins?: ReturnType<typeof createAvogadroPluginRunner>;
};
const noPlugins = { installed: [], initialized: true, error: null, jobs: [] } as const;
const subscribeNothing = () => () => {};
const links = { Source: "https://github.com/OpenChemistry/crystals", Issues: "https://github.com/OpenChemistry/crystals/issues" };

async function openPluginLink(plugin: AvogadroPlugin, link: AvogadroPluginLink) {
  // The desktop shell resolves the address from the index itself.
  if (isTauriRuntime()) await invoke("open_avogadro_plugin_link", { name: plugin.name, link });
  else window.open(pluginLinkUrl(plugin, link), "_blank", "noopener,noreferrer");
}

export function ExtensionsSection({ extensions, catalog: providedCatalog, plugins: providedPlugins }: ExtensionsSectionProps) {
  const [catalog] = useState(() => providedCatalog ?? createAvogadroCatalog());
  const catalogState = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot, catalog.getSnapshot);
  useEffect(() => { void catalog.refresh(); }, [catalog]);
  const [plugins] = useState(() => providedPlugins ?? (isTauriRuntime() ? avogadroPluginRunner() : undefined));
  const pluginState = useSyncExternalStore(plugins?.subscribe ?? subscribeNothing, plugins?.getSnapshot ?? (() => noPlugins), plugins?.getSnapshot ?? (() => noPlugins));
  useEffect(() => { void plugins?.refresh(); }, [plugins]);
  const [dismissedPluginJobs, setDismissedPluginJobs] = useState<ReadonlySet<string>>(new Set());
  const [issue, setIssue] = useState<{ message: string; retry: () => void; focusTarget: "primary" | "links" } | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const library = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!extensions.installed) setBrowsing(false); }, [extensions.installed]);
  useLayoutEffect(() => { if (browsing) library.current?.querySelector<HTMLInputElement>("input")?.focus(); }, [browsing]);
  const [dismissedJob, setDismissedJob] = useState<string | null>(null);
  const primary = useRef<HTMLButtonElement>(null), linkButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef<{ from: HTMLElement; to: "primary" | "links" } | null>(null);
  useEffect(() => {
    const moved = (event: FocusEvent) => { if (restoreFocus.current && event.target !== restoreFocus.current.from) restoreFocus.current = null; };
    document.addEventListener("focusin", moved);
    return () => document.removeEventListener("focusin", moved);
  }, []);
  useLayoutEffect(() => {
    const pending = restoreFocus.current;
    if (!pending || pending.from.isConnected) return;
    restoreFocus.current = null;
    if (document.activeElement && document.activeElement !== document.body) return;
    const target = pending.to === "links" ? linkButton.current : primary.current;
    if (target && !target.disabled) target.focus();
  });
  function rememberFocus(from: HTMLButtonElement) {
    if (document.activeElement === from) restoreFocus.current = { from, to: issue?.focusTarget ?? "primary" };
  }
  const crystalJobs = extensions.jobs.filter(entry => !entry.plugin);
  const job = crystalJobs[0], busy = crystalJobs.find(entry => entry.status === "queued" || entry.status === "running");
  const failed = job?.status === "failed" && job.id !== dismissedJob ? job : undefined;
  const error = issue?.message ?? extensions.error ?? failed?.error;
  async function run(action: () => Promise<unknown>, message = "Could not complete this action. Try again.", focusTarget: "primary" | "links" = "primary") {
    setIssue(null);
    try { await action(); }
    catch { setIssue({ message, focusTarget, retry: () => { void run(action, message, focusTarget); } }); }
  }
  function openLink(label: keyof typeof links) {
    void run(async () => {
      if (isTauriRuntime()) await invoke("open_external_url", { url: links[label] });
      else window.open(links[label], "_blank", "noopener,noreferrer");
    }, `Could not open ${label}. Try again.`, "links");
  }
  const retry = () => {
    if (issue) issue.retry();
    else if (extensions.error) void run(extensions.refresh);
    else void run(failed?.operation === "remove" ? extensions.remove : extensions.installCrystals);
  };
  const status = busy
    ? !busy.cancelable ? "Cancelling…" : busy.phase === "reading"
      ? `${busy.receivedBytes.toLocaleString("en-US")} / ${busy.totalBytes.toLocaleString("en-US")} bytes`
      : busy.phase === "installing" ? "Installing…" : "Removing…"
    : !extensions.initialized ? "Loading…" : extensions.error ? "Unavailable" : extensions.installed ? "Installed" : job?.status === "cancelled" ? "Cancelled" : null;
  const rows: SettingRow[] = [{
    label: "Crystals",
    control: <>
      <span className="text-sm" aria-label={`${CRYSTALS_RESOURCE.corpus.cifCount} CIF structures`}>{CRYSTALS_RESOURCE.corpus.cifCount} CIF</span>
      {status && <span role="status" className="text-sm tabular-nums">{status}</span>}
      {extensions.installed && <Button variant="outline" size="settings" aria-label="Browse crystals" aria-expanded={browsing}
        disabled={Boolean(busy) || !extensions.initialized || Boolean(extensions.error)} onClick={() => setBrowsing(value => !value)}>Browse</Button>}
      {busy ? <Button ref={primary} variant="outline" size="settings" disabled={!busy.cancelable}
        aria-label={`Cancel Crystals ${busy.operation === "install" ? "installation" : "removal"}`} onClick={() => extensions.cancel(busy.id)}>Cancel</Button>
        : <Button ref={primary} variant="outline" size="settings" disabled={!extensions.initialized || Boolean(extensions.error)}
          aria-label={extensions.installed ? "Remove Crystals" : "Install Crystals"}
          onClick={() => { void run(extensions.installed ? extensions.remove : extensions.installCrystals); }}>{extensions.installed ? "Remove" : "Install"}</Button>}
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button ref={linkButton} variant="ghost" size="icon-toolbar" aria-label="Crystals links"><DotsHorizontal aria-hidden /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => openLink("Source")}>Source</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openLink("Issues")}>Report an issue</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>,
  }, { label: "Author", control: <span className="text-sm">Geoffrey Hutchison</span> }];
  if (error) rows.push({ label: "Status", control: <>
    <span role="alert" className="min-w-0 break-words text-sm">{error}</span>
    <Button variant="outline" size="settings" disabled={Boolean(busy)} onClick={event => { rememberFocus(event.currentTarget); retry(); }}>Retry</Button>
    {!extensions.error && <Button variant="ghost" size="settings" disabled={Boolean(busy)} onClick={event => { rememberFocus(event.currentTarget); setIssue(null); setDismissedJob(job?.id ?? null); }}>Dismiss</Button>}
  </> });
  return <>
    <SettingsSection title="Resources" hideTitle rows={rows} />
    {browsing && extensions.installed && !busy && !extensions.error && <div ref={library} className="pt-3">
      <CrystalsBrowser resource={extensions.installed} onOpen={async request => {
        const path = await extensions.openCrystalsStructure(request);
        setBrowsing(false);
        return path;
      }} />
    </div>}
    <AvogadroPluginsSection catalog={catalogState} onRetry={() => { void catalog.refresh(); }} openLink={openPluginLink}
      installedError={pluginState.error} onRetryInstalled={() => { void plugins?.refresh(); }}
      renderPlugin={plugins && (plugin => {
        const job = pluginState.jobs.find(entry => entry.plugin === plugin.name);
        return pluginRowParts({ plugin, installed: pluginState.installed.find(entry => entry.name === plugin.name),
          job: job && !dismissedPluginJobs.has(job.id) ? job : undefined,
          install: target => { void plugins.install(target); }, prepare: name => { void plugins.prepare(name); },
          remove: name => { void plugins.remove(name); }, cancel: plugins.cancel,
          dismiss: jobId => setDismissedPluginJobs(previous => new Set(previous).add(jobId)) });
      })} />
  </>;
}
