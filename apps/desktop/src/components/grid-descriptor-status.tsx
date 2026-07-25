import { useEffect, useState } from "react";
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

  if (!job) return null;

  const total = job.totalRows || 0;
  const done = Math.min(job.processedRows || 0, total);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  // A run of its own card sat between the composition and the engines, so a
  // descriptor pass pushed the tools down and then vanished. It reads as a
  // tool row inside Tools instead, where the other running work already is.
  if (job.running) {
    return (
      <div className="structure-inspector-tool grid-descriptor-status" data-state="running">
        <span className="structure-inspector-tool-rail" aria-hidden="true" />
        <span className="structure-inspector-tool-main">
          <span className="structure-inspector-tool-name">
            RDKit
            <em>descriptors</em>
          </span>
          <span className="structure-inspector-tool-detail">
            {total > 0 ? `Calculating · ${done.toLocaleString()} of ${total.toLocaleString()}` : "Calculating descriptors"}
          </span>
          {/* An all-molecules run reports no total up front. A full bar would read
              as finished, so that case sweeps as indeterminate instead. */}
          {total > 0 ? (
            <div className="grid-descriptor-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${pct}%` }} />
            </div>
          ) : (
            <div className="grid-descriptor-progress indeterminate" aria-hidden><span /></div>
          )}
        </span>
      </div>
    );
  }

  const failed = job.status === "failed";
  const added = job.summary?.descriptorIdCount ?? 0;
  return (
    <div className="structure-inspector-tool grid-descriptor-status" data-state={failed ? "missing" : "ready"}>
      <span className="structure-inspector-tool-rail" aria-hidden="true" />
      <span className="structure-inspector-tool-main">
        <span className="structure-inspector-tool-name">
          RDKit
          <em>descriptors</em>
        </span>
        <span className="structure-inspector-tool-detail">
          {failed
            ? job.message || "Descriptor run failed"
            : added > 0 ? `Added ${added.toLocaleString()} ${added === 1 ? "column" : "columns"}` : "Descriptors calculated"}
        </span>
      </span>
    </div>
  );
}
