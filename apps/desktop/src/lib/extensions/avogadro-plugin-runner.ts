import { invoke } from "@tauri-apps/api/core";
import type { AvogadroPlugin } from "./avogadro-plugin-index";
import type { ResourceJob } from "./resource-install-runner";

/** Mirrors the native `InstalledPlugin` receipt. */
export type InstalledAvogadroPlugin = {
  name: string; version: string; commit: string; sha256: string;
  archiveBytes: number; files: number; expandedBytes: number;
  pyproject: string; licenseText: string | null; prepared: boolean;
};
type Snapshot = { installed: readonly InstalledAvogadroPlugin[]; initialized: boolean; error: string | null; jobs: readonly ResourceJob[] };
type Call = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

const NATIVE_CANCELLED = "Cancelled";
const active = (job: ResourceJob) => job.status === "queued" || job.status === "running";

/** Native errors are mapped to a fixed set of messages; raw text is never shown. */
export function pluginFailure(operation: ResourceJob["operation"], name: string, error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (operation === "remove") return `${name} could not be removed. Try again.`;
  if (/index changed/u.test(text)) return "The Avogadro plugin index changed. Refresh the list and try again.";
  if (/does not match the Avogadro plugin index/u.test(text)) return `The ${name} download did not match the Avogadro plugin index. It was not installed.`;
  if (/archive|symbolic link|duplicate paths|pyproject/u.test(text)) return `The ${name} package could not be read safely. It was not installed.`;
  if (/cannot be installed/u.test(text)) return `${name} cannot be installed by Burette.`;
  return `${name} could not be installed. Check the connection and try again.`;
}

/** One operation per plugin at a time; independent plugins may run concurrently. */
export function createAvogadroPluginRunner({ call = invoke as Call }: { call?: Call } = {}) {
  let snapshot: Snapshot = { installed: [], initialized: false, error: null, jobs: [] };
  const listeners = new Set<() => void>(), flights = new Map<string, { id: string; promise: Promise<ResourceJob> }>();
  const publish = (patch: Partial<Snapshot>) => { snapshot = { ...snapshot, ...patch }; listeners.forEach(listener => listener()); };
  const update = (id: string, patch: Partial<ResourceJob>) => {
    publish({ jobs: snapshot.jobs.map(job => job.id === id ? { ...job, ...patch } : job) });
    return snapshot.jobs.find(job => job.id === id)!;
  };
  async function refresh() {
    try { publish({ installed: await call<InstalledAvogadroPlugin[]>("avogadro_plugins_installed"), initialized: true, error: null }); }
    catch { publish({ initialized: true, error: "Installed plugins could not be read. Retry." }); }
  }
  function start(name: string, operation: "install" | "update" | "remove", title: string, work: (id: string) => Promise<void>) {
    const running = flights.get(name);
    if (running) return running.promise;
    const id = crypto.randomUUID();
    const job: ResourceJob = { id, operation, title, plugin: name, status: "running", startedAt: Date.now(), cancelable: operation !== "remove",
      phase: operation === "remove" ? "removing" : "installing", receivedBytes: 0, totalBytes: 0 };
    publish({ error: null, jobs: [job, ...snapshot.jobs].slice(0, 20) });
    const promise = work(id).then(
      () => update(id, { status: "success", cancelable: false, completedAt: Date.now() }),
      error => {
        const cancelled = (error instanceof Error ? error.message : String(error)) === NATIVE_CANCELLED;
        return update(id, { status: cancelled ? "cancelled" : "failed", cancelable: false, completedAt: Date.now(),
          error: cancelled ? undefined : pluginFailure(operation, name, error) });
      },
    ).finally(() => { flights.delete(name); void refresh(); });
    flights.set(name, { id, promise });
    return promise;
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh,
    owns: (jobId: string) => snapshot.jobs.some(job => job.id === jobId),
    install(plugin: AvogadroPlugin) {
      const update = snapshot.installed.some(installed => installed.name === plugin.name);
      return start(plugin.name, update ? "update" : "install", `${update ? "Update" : "Install"} ${plugin.name}`, async jobId => {
        const installed = await call<InstalledAvogadroPlugin>("avogadro_plugin_install", { jobId, name: plugin.name, commit: plugin.commit });
        publish({ installed: [...snapshot.installed.filter(entry => entry.name !== installed.name), installed].sort((left, right) => left.name.localeCompare(right.name)) });
      });
    },
    remove(name: string) {
      return start(name, "remove", `Remove ${name}`, async () => {
        await call("avogadro_plugin_remove", { name });
        publish({ installed: snapshot.installed.filter(entry => entry.name !== name) });
      });
    },
    cancel(jobId: string) {
      const job = snapshot.jobs.find(entry => entry.id === jobId);
      if (!job || !active(job) || !job.cancelable) return;
      update(jobId, { cancelable: false });
      void call("avogadro_plugin_cancel", { jobId }).catch(() => {});
    },
    clearFinished() { publish({ jobs: snapshot.jobs.filter(active) }); },
  };
}

let shared: ReturnType<typeof createAvogadroPluginRunner> | undefined;
/** The app-wide runner: Settings and the Jobs list observe the same jobs. */
export const avogadroPluginRunner = () => shared ??= createAvogadroPluginRunner();
