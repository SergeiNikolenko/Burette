import { useRef, useState, type ReactNode } from "react";
import { CheckCircle, ChevronRight, ExclamationCircle, Flask, Search, Stopwatch, Warning, XCircleCrossedClose } from "./ui/app-icons";
import { PanelEmptyState } from "./ui/panel-empty-state";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "./ui/alert-dialog";
import { SearchInput } from "./ui/search-input";
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
  /** `page` is the Jobs screen (Codex list page); `dock` is the compact panel list. */
  variant?: "dock" | "page";
};
type JobFilter = "all" | "active" | "done" | "failed";

const statusLabels: Record<string, string> = {
  queued: "Queued", running: "Running", success: "Done", recovered: "Partial", failed: "Failed", cancelled: "Cancelled",
};
const statusIcons: Record<string, ReactNode> = {
  queued: <Stopwatch aria-hidden />, success: <CheckCircle aria-hidden />, recovered: <Warning aria-hidden />,
  failed: <ExclamationCircle aria-hidden />, cancelled: <XCircleCrossedClose aria-hidden />,
};
const filters: { value: JobFilter; label: string }[] = [
  { value: "all", label: "All" }, { value: "active", label: "Active" }, { value: "done", label: "Done" }, { value: "failed", label: "Failed" },
];
const active = (row: JobRow) => row.status === "running" || row.status === "queued";
const matchesFilter: Record<JobFilter, (row: JobRow) => boolean> = {
  all: () => true,
  active,
  done: row => row.status === "success" || row.status === "recovered",
  failed: row => row.status === "failed" || row.status === "cancelled",
};

export function JobsPanel({ state, actions, variant = "dock" }: Props) {
  const panel = useRef<HTMLElement>(null);
  const cleared = useRef(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<JobFilter>("all");
  const page = variant === "page";
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
  rows.sort((left, right) => Number(active(right)) - Number(active(left)) || right.startedAt - left.startedAt);
  const pending = rows.filter(active).length;
  const needle = query.trim().toLowerCase();
  const visible = page
    ? rows.filter(row => matchesFilter[filter](row) && (!needle || `${row.title}\n${row.source}`.toLowerCase().includes(needle)))
    : rows;
  const clearTrigger = <AlertDialogTrigger asChild>
    <Button type="button" variant={page ? "secondary" : "ghost"} size={page ? "toolbar" : "xs"} disabled={rows.length === pending}>Clear finished</Button>
  </AlertDialogTrigger>;
  return (
    <section ref={panel} className="jobs-panel" data-variant={variant} aria-label="Calculations" tabIndex={-1}>
      <AlertDialog>
        {page ? <header className="jobs-page-header">
          <h1>Jobs</h1>
          {rows.length > 0 && clearTrigger}
        </header> : rows.length > 0 && <div className="jobs-panel-toolbar">
          <span role="status">{pending ? `${pending} active · ` : ""}{rows.length} {rows.length === 1 ? "job" : "jobs"}</span>
          {clearTrigger}
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
      {page && rows.length > 0 && <>
        <SearchInput className="jobs-page-search" value={query} onValueChange={setQuery} placeholder="Search jobs" aria-label="Search jobs" />
        <div className="jobs-page-filters" role="group" aria-label="Filter jobs">
          {filters.map(item => <Button key={item.value} type="button" variant="ghost" size="toolbar"
            aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}</Button>)}
        </div>
      </>}
      {rows.length === 0 ? <div className="jobs-panel-empty" role="status"><PanelEmptyState title="No calculations yet" icon={<Flask />} /></div>
        : visible.length === 0 ? <div className="jobs-panel-empty" role="status"><PanelEmptyState title="No matching jobs" icon={<Search />} /></div> : (
        <ol className="jobs-panel-list">
          {visible.map((job) => (
            <Collapsible asChild key={job.id}>
              <li className="jobs-panel-row" data-status={job.status}>
                <div className="jobs-panel-row-header">
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="ghost" className="jobs-panel-toggle" aria-label={`Details for ${job.title}`}>
                      {page ? <>
                        <span className="jobs-panel-icon">{active(job) ? <Spinner aria-hidden /> : statusIcons[job.status] ?? <Flask aria-hidden />}</span>
                        <span className="jobs-panel-text">
                          <strong title={job.title}>{job.title}</strong>
                          <span className="jobs-panel-meta">
                            <span className="jobs-panel-status">{statusLabels[job.status] ?? job.status}</span>
                            {job.source && <span className="jobs-panel-source" title={job.source}>{job.source}</span>}
                          </span>
                        </span>
                      </> : <>
                        <ChevronRight className="jobs-panel-chevron size-3" aria-hidden />
                        <strong title={job.title}>{job.title}</strong>
                        <span className="jobs-panel-status">{active(job) ? <Spinner className="size-3" aria-hidden /> : null}{statusLabels[job.status] ?? job.status}</span>
                      </>}
                    </Button>
                  </CollapsibleTrigger>
                  <div className="jobs-panel-actions">
                    {job.cancel ? <Button type="button" variant="ghost" size={page ? "toolbar" : "xs"} onClick={job.cancel}>Cancel</Button> : null}
                    {job.open ? <Button type="button" variant="ghost" size={page ? "toolbar" : "xs"} onClick={job.open}>Open result</Button>
                      : job.report ? <Button type="button" variant="ghost" size={page ? "toolbar" : "xs"} onClick={job.report}>Report</Button> : null}
                  </div>
                </div>
                <CollapsibleContent className="jobs-panel-details">
                  {job.source && !page && <p>{job.source}</p>}
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
