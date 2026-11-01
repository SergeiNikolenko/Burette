import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { journalAction } from "../lib/action-journal";
import { avogadroPluginRunner } from "../lib/extensions/avogadro-plugin-runner";
import { createResourceInstallRunner, type ResourceJob } from "../lib/extensions/resource-install-runner";
import { isTauriRuntime } from "../lib/tauri";

const noPlugins: { jobs: readonly ResourceJob[] } = { jobs: [] };
const subscribeNothing = () => () => {};

export function useResourceExtensions() {
  const [runner] = useState(createResourceInstallRunner);
  // Avogadro packages install only through the desktop shell.
  const [plugins] = useState(() => isTauriRuntime() ? avogadroPluginRunner() : undefined);
  const state = useSyncExternalStore(runner.subscribe, runner.getSnapshot, runner.getSnapshot);
  const pluginSnapshot = plugins?.getSnapshot ?? ((): { jobs: readonly ResourceJob[] } => noPlugins);
  const pluginState = useSyncExternalStore(plugins?.subscribe ?? subscribeNothing, pluginSnapshot, pluginSnapshot);
  const jobs = useMemo((): readonly ResourceJob[] => [...state.jobs, ...pluginState.jobs].sort((left, right) => right.startedAt - left.startedAt), [state.jobs, pluginState.jobs]);
  const previous = useRef(new Map<string, string>());
  useEffect(() => {
    const refresh = () => { void runner.refresh(); void plugins?.refresh(); };
    refresh(); window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [runner, plugins]);
  useEffect(() => {
    for (const job of jobs) {
      if (previous.current.get(job.id) !== job.status) journalAction("job", `extensions:${job.status}`, {
        target: job.title, detail: { id: job.id, operation: job.operation, error: job.error },
      });
    }
    previous.current = new Map(jobs.map(job => [job.id, job.status]));
  }, [jobs]);
  // The shared lifecycle's native completion notifications default to on.
  // Extension jobs keep bounded history and journal transitions without notifications.
  return { ...state, jobs, installCrystals: runner.installCrystals, remove: runner.remove, refresh: runner.refresh,
    cancel: (jobId: string) => { if (plugins?.owns(jobId)) plugins.cancel(jobId); else runner.cancel(jobId); },
    clearFinished: () => { runner.clearFinished(); plugins?.clearFinished(); } };
}
