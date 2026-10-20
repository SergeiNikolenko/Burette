import { useEffect, useState } from "react";
import { Progress } from "./ui/progress";
import { Spinner } from "./ui/spinner";
import { GRID_DESCRIPTOR_JOB_EVENT } from "../hooks/use-app-descriptors";
import type { GridDescriptorJobStatus } from "../lib/descriptors";

// Keep a finished run visible briefly so the user sees the outcome instead of
// the card just vanishing the instant the job completes.
const DONE_LINGER_MS = 6000;

// The panel can unmount and remount while a run is in flight (switching docs or
// Inspector tabs), so the latest status per document is cached at module scope
// by an always-on listener. A remounting card seeds from it instead of missing
// the run entirely because it was not listening when the event fired.
const latestJobs = new Map<string, GridDescriptorJobStatus>();
if (typeof window !== "undefined") {
  window.addEventListener(GRID_DESCRIPTOR_JOB_EVENT, (event: Event) => {
    const status = (event as CustomEvent<GridDescriptorJobStatus>).detail;
    if (status?.documentId) latestJobs.set(status.documentId, status);
  });
}

// Mirrors the descriptor job the grid kicks off in the Info panel: a spinner and
// running count while it works, a short summary after.
export function GridDescriptorStatus({ documentId }: { documentId: string }) {
  const [job, setJob] = useState<GridDescriptorJobStatus | null>(() => latestJobs.get(documentId) ?? null);

  useEffect(() => {
    setJob(latestJobs.get(documentId) ?? null);
    const onJob = (event: Event) => {
      const status = (event as CustomEvent<GridDescriptorJobStatus>).detail;
      if (!status || status.documentId !== documentId) return;
      setJob(status);
    };
    window.addEventListener(GRID_DESCRIPTOR_JOB_EVENT, onJob);
    return () => window.removeEventListener(GRID_DESCRIPTOR_JOB_EVENT, onJob);
  }, [documentId]);

  // Drop the card a few seconds after a run settles.
  useEffect(() => {
    if (!job || job.running) return;
    const timer = window.setTimeout(() => setJob(null), DONE_LINGER_MS);
    return () => window.clearTimeout(timer);
  }, [job]);

  if (!job || job.documentId !== documentId || job.status === "idle") return null;

  const total = job.totalRows || 0;
  const done = Math.min(job.processedRows || 0, total);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const added = job.summary?.descriptorIdCount ?? 0;
  const outcome = job.running ? "Calculating…"
    : job.status === "failed" ? "Failed"
    : job.status === "cancelled" ? "Cancelled"
    : job.failedRows > 0 ? "Completed with errors" : "Completed";
  const count = job.running && total > 0 ? `${done.toLocaleString()} of ${total.toLocaleString()}`
    : !job.running && job.status === "completed" && job.failedRows > 0 ? `${job.failedRows.toLocaleString()} failed`
    : !job.running && job.status === "completed" && added > 0 ? `${added.toLocaleString()} ${added === 1 ? "column" : "columns"} added` : null;
  return (
    <div className="grid min-w-0 gap-2 px-2 py-1 text-sm" data-state={job.status}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="text-(--color-text)">Molecular properties</span>
        <span role="status" className={`flex items-center gap-1 text-xs ${job.status === "failed" ? "text-(--color-text-danger)" : "text-(--color-text-secondary)"}`}>
          {job.running ? <Spinner aria-hidden className="size-3" /> : null}{outcome}
        </span>
      </div>
      {count ? <span className="text-xs text-(--color-text-secondary) tabular-nums">{count}</span> : null}
      {job.running ? <Progress aria-label="Molecular properties" value={total > 0 ? pct : null} /> : null}
    </div>
  );
}
