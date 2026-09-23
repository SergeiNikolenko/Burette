import type { ShellActions, ShellViewState } from "./types";
import { Button } from "./ui/button";

type JobRow = {
  id: string; title: string; source: string; status: string; startedAt: number;
  summary?: string | null; details?: string | null;
  cancel?: () => void; open?: () => void; report?: () => void; log?: () => void;
};
type Props = {
  state: Pick<ShellViewState, "conformerJobs" | "xtbJobs" | "derivedColumnJobs" | "databaseJobs">;
  actions: ShellActions;
};
const statusLabels: Record<string, string> = {
  queued: "Queued", running: "Running", success: "Done", recovered: "Partial", failed: "Failed", cancelled: "Cancelled",
};

export function JobsPanel({ state, actions }: Props) {
  const openPath = (path?: string | null) => path ? () => { void actions.openPaths([path]); } : undefined;
  const openText = (path?: string | null) => path ? () => { void actions.openTextPaths([path]); } : undefined;
  const rows: JobRow[] = [
    ...state.conformerJobs.map((job): JobRow => ({
      ...job, id: `compute:${job.id}`, source: job.inputTitle, summary: job.progress, details: job.error,
      cancel: job.status === "running" && job.cancelable !== false ? () => { void actions.cancelConformerJob(job.id); } : undefined,
      open: openPath(job.primaryOpenPath ?? job.result?.primaryOpenPath), report: openText(job.reportPath), log: openText(job.logPath),
    })),
    ...state.xtbJobs.map((job): JobRow => ({
      ...job, id: `xtb:${job.id}`, source: job.inputLabel, details: job.error,
      cancel: job.status === "running" ? () => { void actions.cancelXtbJob(job.id); } : undefined,
      open: openPath(job.result?.primaryOpenPath), report: openText(job.result?.reportPath), log: openText(job.result?.logPath),
    })),
    ...state.derivedColumnJobs.map((job): JobRow => ({
      ...job, id: `columns:${job.id}`, title: job.columnLabel, source: job.documentTitle,
      status: job.status === "success" && job.failedRows > 0 ? "recovered" : job.status,
      summary: job.status === "running" ? `${job.processedRows} / ${job.totalRows || "…"} rows`
        : `${job.processedRows - job.failedRows} values${job.failedRows ? ` · ${job.failedRows} failed` : ""}`,
      details: job.error,
    })),
    ...state.databaseJobs.map((job): JobRow => ({
      ...job, id: `database:${job.id}`, source: job.query,
      summary: job.recordCount === undefined ? null : `${job.recordCount} records`,
      details: [job.error, ...(job.warnings ?? [])].filter(Boolean).join("\n"),
      open: job.documentId ? () => actions.selectDocument(job.documentId!) : undefined,
    })),
  ];
  const active = (row: JobRow) => row.status === "running" || row.status === "queued";
  rows.sort((left, right) => Number(active(right)) - Number(active(left)) || right.startedAt - left.startedAt);
  const running = rows.filter(active).length;
  return (
    <section className="jobs-panel" aria-label="Calculations">
      <div className="jobs-panel-toolbar">
        <span>{running ? `${running} running · ` : ""}{rows.length} {rows.length === 1 ? "job" : "jobs"}</span>
        <Button variant="ghost" size="xs" disabled={rows.length === running} onClick={() => {
          actions.clearConformerJobs(); actions.clearXtbJobs(); actions.clearDerivedColumnJobs(); actions.clearDatabaseJobs();
        }}>Clear finished</Button>
      </div>
      {rows.length === 0 ? <p className="dock-empty">No calculations yet</p> : (
        <ol className="jobs-panel-list">
          {rows.map((job) => (
            <li key={job.id} className="jobs-panel-row" data-status={job.status}>
              <details className="jobs-panel-details">
                <summary>
                  <span className="jobs-panel-heading">
                    <strong title={job.title}>{job.title}</strong>
                    <span className="jobs-panel-status">{active(job) ? <span className="dock-job-spinner" aria-hidden="true" /> : null}{statusLabels[job.status] ?? job.status}</span>
                  </span>
                </summary>
                <p className="jobs-panel-summary">{[job.source, job.summary].filter(Boolean).join(" · ")}</p>
                {job.details ? <pre>{job.details}</pre> : null}
                <div className="jobs-panel-actions">
                  {job.report && job.open ? <Button variant="ghost" size="xs" onClick={job.report}>Report</Button> : null}
                  {job.log ? <Button variant="ghost" size="xs" onClick={job.log}>Log</Button> : null}
                </div>
              </details>
              <div className="jobs-panel-actions">
                {job.cancel ? <Button variant="ghost" size="xs" onClick={job.cancel}>Cancel</Button> : null}
                {job.open ? <Button variant="ghost" size="xs" onClick={job.open}>Open result</Button>
                  : job.report ? <Button variant="ghost" size="xs" onClick={job.report}>Report</Button> : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
