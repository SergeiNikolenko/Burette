import { type Dispatch, type MutableRefObject, type SetStateAction, useEffect } from "react";

import { conformerOperationLabel, xtbOperationLabel } from "../lib/chemistry-settings";
import { listRemoteJobs, resumeRemoteJob, type RemoteJob } from "../lib/remote-jobs";
import type { ConformerJob, ConformerOperation, ConformerRunResult, XtbJob, XtbOperation, XtbRunResult } from "../types";

type PushStatus = (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;

type Options = {
  cancelledConformerJobIdsRef: MutableRefObject<Set<string>>;
  cancelledXtbJobIdsRef: MutableRefObject<Set<string>>;
  pushStatus: PushStatus;
  setConformerJobs: Dispatch<SetStateAction<ConformerJob[]>>;
  setXtbJobs: Dispatch<SetStateAction<XtbJob[]>>;
};

// One follower per job in this window, even when the effect runs twice.
const followed = new Set<string>();
const text = (value: unknown) => typeof value === "string" ? value : undefined;

function followXtb(job: RemoteJob, { cancelledXtbJobIdsRef, pushStatus, setXtbJobs }: Options) {
  const operation = (text(job.context.operation) ?? "properties") as XtbOperation;
  const title = xtbOperationLabel(operation);
  const row: XtbJob = {
    id: job.id, title, operation, status: "running", inputLabel: text(job.context.label) ?? title,
    host: job.host, startedAt: job.submittedAt, completedAt: null, result: null, error: null,
  };
  setXtbJobs(previous => [row, ...previous.filter(entry => entry.id !== job.id)].slice(0, 20));
  const finish = (update: Partial<XtbJob>) => setXtbJobs(previous => previous.map(entry => entry.id === job.id ? { ...entry, completedAt: Date.now(), ...update } : entry));
  void resumeRemoteJob<XtbRunResult>(job.id).then(result => {
    const cancelled = cancelledXtbJobIdsRef.current.has(job.id) || result.exitCode === 130;
    finish({ status: cancelled ? "cancelled" : result.ok ? "success" : result.primaryOpenPath ? "recovered" : "failed", result, error: result.error ?? null });
    if (!cancelled) pushStatus(`xTB ${result.ok ? "finished" : "failed"} on ${job.host}: ${title}`, result.ok ? "success" : "error", result.error ? [result.error] : []);
  }).catch((error: unknown) => finish({ status: "failed", error: error instanceof Error ? error.message : String(error) }));
}

function followConformer(job: RemoteJob, { cancelledConformerJobIdsRef, pushStatus, setConformerJobs }: Options) {
  const operation = (text(job.context.operation) ?? "crest-generate") as ConformerOperation;
  const title = conformerOperationLabel(operation);
  const row: ConformerJob = {
    id: job.id, title, operation, inputTitle: text(job.context.title) ?? title, status: "running",
    host: job.host, startedAt: job.submittedAt, workDir: job.workDir, logPath: job.logPath, result: null, error: null,
  };
  setConformerJobs(previous => [row, ...previous.filter(entry => entry.id !== job.id)].slice(0, 20));
  const finish = (update: Partial<ConformerJob>) => setConformerJobs(previous => previous.map(entry => entry.id === job.id ? { ...entry, completedAt: Date.now(), ...update } : entry));
  void resumeRemoteJob<ConformerRunResult>(job.id).then(result => {
    const cancelled = cancelledConformerJobIdsRef.current.has(job.id) || result.exitCode === 130;
    finish({
      status: cancelled ? "cancelled" : result.ok ? (result.exitCode === 0 ? "success" : "recovered") : "failed",
      reportPath: result.reportPath, primaryOpenPath: result.primaryOpenPath, result,
      error: result.errorSummary ?? (result.ok ? null : `Exited with code ${result.exitCode}`),
    });
    if (!cancelled) pushStatus(`${title} ${result.ok ? "finished" : "failed"} on ${job.host}: ${row.inputTitle}`, result.ok ? "success" : "error");
  }).catch((error: unknown) => finish({ status: "failed", error: error instanceof Error ? error.message : String(error) }));
}

/** Lists SSH jobs started before the app restarted and follows them to completion. */
export function useRemoteJobReattach(options: Options) {
  useEffect(() => {
    void listRemoteJobs().then(jobs => {
      for (const job of jobs) {
        if (followed.has(job.id)) continue;
        followed.add(job.id);
        if (job.tool === "xtb") followXtb(job, options);
        else followConformer(job, options);
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setters and refs are stable; list once per window
  }, []);
}
