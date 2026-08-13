import { useEffect, useMemo, useState } from "react";

import { GRID_DESCRIPTOR_JOB_EVENT } from "../hooks/use-app-descriptors";
import type { GridDescriptorJobStatus } from "../lib/descriptors";
import type { ShellActions, ShellViewState } from "./types";
import { ShortcutTooltip } from "./shortcut-tooltip";

// Corner activity spinner: visible whenever any background computation is
// running (derived columns, conformers, xTB, grid descriptor runs), so a run
// started from a menu is never invisible chrome-wide. Clicking it opens the
// Jobs tab in the bottom dock, where the runs report in detail.
export function ActivityIndicator({ state, actions }: { state: ShellViewState; actions: ShellActions }) {
  const [descriptorRuns, setDescriptorRuns] = useState<ReadonlyMap<string, boolean>>(new Map());

  useEffect(() => {
    const onJob = (event: Event) => {
      const status = (event as CustomEvent<GridDescriptorJobStatus>).detail;
      if (!status?.documentId) return;
      setDescriptorRuns((previous) => {
        if ((previous.get(status.documentId) ?? false) === status.running) return previous;
        const next = new Map(previous);
        if (status.running) next.set(status.documentId, true);
        else next.delete(status.documentId);
        return next;
      });
    };
    window.addEventListener(GRID_DESCRIPTOR_JOB_EVENT, onJob);
    return () => window.removeEventListener(GRID_DESCRIPTOR_JOB_EVENT, onJob);
  }, []);

  const runningLabels = useMemo(() => {
    const labels: string[] = [];
    for (const job of state.derivedColumnJobs) {
      if (job.status === "running") labels.push(job.columnLabel);
    }
    for (const job of state.conformerJobs) {
      if (job.status === "running") labels.push(job.title);
    }
    for (const job of state.xtbJobs) {
      if (job.status === "running" || job.status === "queued") labels.push(job.title);
    }
    for (const running of descriptorRuns.values()) {
      if (running) labels.push("Descriptors");
    }
    return labels;
  }, [descriptorRuns, state.conformerJobs, state.derivedColumnJobs, state.xtbJobs]);

  if (runningLabels.length === 0) return null;

  const label = runningLabels.length === 1
    ? `Running: ${runningLabels[0]}`
    : `Running ${runningLabels.length} jobs`;
  return (
    <button
      type="button"
      className="chrome-button activity-indicator"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => actions.openDockTab("bottom", "jobs")}
      aria-label={label}
    >
      <span className="activity-indicator-spinner" aria-hidden="true" />
      {runningLabels.length > 1 ? (
        <span className="activity-indicator-count">{runningLabels.length}</span>
      ) : null}
      <ShortcutTooltip label={label} />
    </button>
  );
}
