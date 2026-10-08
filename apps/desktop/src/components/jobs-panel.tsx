import { useRef } from "react";
import { ChevronRight } from "./ui/app-icons";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "./ui/alert-dialog";
import { Spinner } from "./ui/spinner";
import type { ShellActions, ShellViewState } from "./types";
import { Button } from "./ui/button";

type JobRow = {
  id: string; title: string; source: string; status: string; startedAt: number;
  summary?: string | null; details?: string | null;
  cancel?: () => void; open?: () => void; report?: () => void; log?: () => void;
};
type Props = {
  state: Pick<ShellViewState, "conformerJobs" | "xtbJobs" | "derivedColumnJobs" | "databaseJobs">;
  actions: Pick<ShellActions, "openPaths" | "openTextPaths" | "cancelConformerJob" | "cancelXtbJob" | "selectDocument" | "clearConformerJobs" | "clearXtbJobs" | "clearDerivedColumnJobs" | "clearDatabaseJobs">;
};
const statusLabels: Record<string, string> = {
  queued: "Queued", running: "Running", success: "Done", recovered: "Partial", failed: "Failed", cancelled: "Cancelled",
};

export function JobsPanel({ state, actions }: Props) {
  const panel = useRef<HTMLElement>(null);
  const cleared = useRef(false);
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
  const pending = rows.filter(active).length;
  return (
    <section ref={panel} className="jobs-panel" aria-label="Calculations" tabIndex={-1}>
      <AlertDialog>
        {rows.length > 0 && <div className="jobs-panel-toolbar">
          <span role="status">{pending ? `${pending} active · ` : ""}{rows.length} {rows.length === 1 ? "job" : "jobs"}</span>
          <AlertDialogTrigger asChild><Button type="button" variant="ghost" size="xs" disabled={rows.length === pending}>Clear finished</Button></AlertDialogTrigger>
        </div>}
        <AlertDialogContent onCloseAutoFocus={event => {
          if (!cleared.current) return;
          cleared.current = false; event.preventDefault(); panel.current?.focus();
        }}>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear finished calculations?</AlertDialogTitle>
            <AlertDialogDescription>Finished jobs will be removed from this list. Active jobs and result files are kept.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => {
              cleared.current = true;
              actions.clearConformerJobs(); actions.clearXtbJobs(); actions.clearDerivedColumnJobs(); actions.clearDatabaseJobs();
            }}>Clear finished</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {rows.length === 0 ? <p className="jobs-panel-empty" role="status">No calculations yet</p> : (
        <ol className="jobs-panel-list">
          {rows.map((job) => (
            <Collapsible asChild key={job.id}>
              <li className="jobs-panel-row" data-status={job.status}>
                <div className="jobs-panel-row-header">
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="ghost" className="jobs-panel-toggle" aria-label={`Details for ${job.title}`}>
                      <ChevronRight className="jobs-panel-chevron size-3" aria-hidden />
                      <strong title={job.title}>{job.title}</strong>
                      <span className="jobs-panel-status">{active(job) ? <Spinner className="size-3" aria-hidden /> : null}{statusLabels[job.status] ?? job.status}</span>
                    </Button>
                  </CollapsibleTrigger>
                  <div className="jobs-panel-actions">
                    {job.cancel ? <Button type="button" variant="ghost" size="xs" onClick={job.cancel}>Cancel</Button> : null}
                    {job.open ? <Button type="button" variant="ghost" size="xs" onClick={job.open}>Open result</Button>
                      : job.report ? <Button type="button" variant="ghost" size="xs" onClick={job.report}>Report</Button> : null}
                  </div>
                </div>
                <CollapsibleContent className="jobs-panel-details">
                  {job.source && <p>{job.source}</p>}
                  {job.summary && <p>{job.summary}</p>}
                  {(job.details || job.log || (job.report && job.open)) && <div className="jobs-panel-actions">
                    {job.report && job.open ? <Button type="button" variant="ghost" size="xs" onClick={job.report}>Report</Button> : null}
                    {job.log ? <Button type="button" variant="ghost" size="xs" onClick={job.log}>Log</Button> : null}
                    {job.details && <Dialog>
                      <DialogTrigger asChild><Button type="button" variant="ghost" size="xs">Details</Button></DialogTrigger>
                      <DialogContent>
                        <DialogHeader><DialogTitle>{job.title}</DialogTitle></DialogHeader>
                        <DialogDescription className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words">{job.details}</DialogDescription>
                      </DialogContent>
                    </Dialog>}
                  </div>}
                </CollapsibleContent>
              </li>
            </Collapsible>
          ))}
        </ol>
      )}
    </section>
  );
}
