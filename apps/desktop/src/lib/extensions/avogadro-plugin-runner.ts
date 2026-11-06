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
  if (operation === "prepare") {
    if (/pixi is not installed/u.test(text)) return "Setting up a plugin needs pixi. Install pixi, then try again.";
    if (/declares no pixi environment/u.test(text)) return `${name} does not declare an environment Burette can set up.`;
    if (/timed out/u.test(text)) return `Setting up ${name} took too long and was stopped.`;
    return `${name} could not be set up. Check the connection and try again.`;
  }
  if (operation === "run") {
    if (/Set up this plugin/u.test(text)) return `Set up ${name} before running its commands.`;
    if (/timed out/u.test(text)) return "The command took too long and was stopped.";
    return "The command failed. Try again, or check the structure it was given.";
  }
  if (/index changed/u.test(text)) return "The Avogadro plugin index changed. Refresh the list and try again.";
  if (/does not match the Avogadro plugin index/u.test(text)) return `The ${name} download did not match the Avogadro plugin index. It was not installed.`;
  if (/archive|symbolic link|duplicate paths|pyproject/u.test(text)) return `The ${name} package could not be read safely. It was not installed.`;
  if (/cannot be installed/u.test(text)) return `${name} cannot be installed by Burette.`;
  return `${name} could not be installed. Check the connection and try again.`;
}

/** One operation per plugin at a time; independent plugins may run concurrently. */
export function createAvogadroPluginRunner({ call = invoke as Call }: { call?: Call } = {}) {
  let snapshot: Snapshot = { installed: [], initialized: false, error: null, jobs: [] };
  const listeners = new Set<() => void>(), flights = new Map<string, { id: string; operation: ResourceJob["operation"]; promise: Promise<ResourceJob> }>();
  const publish = (patch: Partial<Snapshot>) => { snapshot = { ...snapshot, ...patch }; listeners.forEach(listener => listener()); };
  const replaceInstalled = (installed: InstalledAvogadroPlugin) =>
    publish({ installed: [...snapshot.installed.filter(entry => entry.name !== installed.name), installed].sort((left, right) => left.name.localeCompare(right.name)) });
  const update = (id: string, patch: Partial<ResourceJob>) => {
    publish({ jobs: snapshot.jobs.map(job => job.id === id ? { ...job, ...patch } : job) });
    return snapshot.jobs.find(job => job.id === id)!;
  };
  async function refresh() {
    try { publish({ installed: await call<InstalledAvogadroPlugin[]>("avogadro_plugins_installed"), initialized: true, error: null }); }
    catch { publish({ initialized: true, error: "Installed plugins could not be read. Retry." }); }
  }
  function start(name: string, operation: ResourceJob["operation"], title: string, work: (id: string) => Promise<void>) {
    const running = flights.get(name);
    if (running) return running.operation === operation ? running.promise : Promise.reject(new Error(`${name} is busy. Wait for its current job or cancel it.`));
    const id = crypto.randomUUID();
    const phase = ({ install: "installing", update: "installing", remove: "removing", prepare: "preparing", run: "running" } as const)[operation];
    const job: ResourceJob = { id, operation, title, plugin: name, status: "running", startedAt: Date.now(), cancelable: operation !== "remove",
      phase, receivedBytes: 0, totalBytes: 0 };
    publish({ error: null, jobs: [job, ...snapshot.jobs].slice(0, 20) });
    const promise = work(id).then(
      () => update(id, { status: "success", cancelable: false, completedAt: Date.now() }),
      error => {
        const cancelled = (error instanceof Error ? error.message : String(error)) === NATIVE_CANCELLED;
        return update(id, { status: cancelled ? "cancelled" : "failed", cancelable: false, completedAt: Date.now(),
          error: cancelled ? undefined : pluginFailure(operation, name, error) });
      },
    ).finally(() => { flights.delete(name); void refresh(); });
    flights.set(name, { id, operation, promise });
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
        replaceInstalled(await call<InstalledAvogadroPlugin>("avogadro_plugin_install", { jobId, name: plugin.name, commit: plugin.commit }));
      });
    },
    /** Runs `pixi install` for the package: its own code and dependencies. */
    prepare(name: string) {
      return start(name, "prepare", `Set up ${name}`, async jobId => {
        replaceInstalled(await call<InstalledAvogadroPlugin>("avogadro_plugin_prepare", { jobId, name }));
      });
    },
    /** Runs one declared feature (a menu command, a file reader or an input generator); resolves with the job and the script's stdout when it succeeded. */
    async run(name: string, title: string, request: { script: string; identifier: string; operation: "command" | "read"; input: string }) {
      let stdout: string | undefined;
      const job = await start(name, "run", title, async jobId => {
        stdout = await call<string>("avogadro_plugin_run", { jobId, name, ...request });
      });
      return { job, stdout };
    },
    readOptions: (name: string, path: string) => call<string>("avogadro_plugin_options", { name, path }),
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
