import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { journalAction } from "../lib/action-journal";
import { createResourceInstallRunner } from "../lib/extensions/resource-install-runner";

export function useResourceExtensions() {
  const [runner] = useState(createResourceInstallRunner);
  const state = useSyncExternalStore(runner.subscribe, runner.getSnapshot, runner.getSnapshot);
  const previous = useRef(new Map<string, string>());
  useEffect(() => {
    const refresh = () => { void runner.refresh(); };
    refresh(); window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [runner]);
  useEffect(() => {
    for (const job of state.jobs) {
      if (previous.current.get(job.id) !== job.status) journalAction("job", `extensions:${job.status}`, {
        target: job.title, detail: { id: job.id, operation: job.operation, error: job.error },
      });
    }
    previous.current = new Map(state.jobs.map(job => [job.id, job.status]));
  }, [state.jobs]);
  // The shared lifecycle's native completion notifications default to on.
  // Extension jobs keep bounded history and journal transitions without notifications.
  return { ...state, installCrystals: runner.installCrystals, remove: runner.remove, refresh: runner.refresh,
    cancel: runner.cancel, clearFinished: runner.clearFinished };
}
