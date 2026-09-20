import { Channel, invoke } from "@tauri-apps/api/core";
import { publishConformerJob } from "./conformer-job-events";
import type { ConformerJob } from "../types";

type AnalysisProgress = {
  jobId: string;
  completed: number;
  total: number;
  partialReportPath: string | null;
};

type AnalysisResult = { reportPath: string | null; backend: string };

export async function runAnalysisWorkflow<T extends AnalysisResult>(
  command: "compute_evaluate_grid_semiempirical" | "compute_align_grid_poses",
  request: { documentId: string; sourceIndexes: number[]; method?: string; maxMemoryBytes?: number },
  inputTitle: string,
): Promise<T> {
  const alignment = command === "compute_align_grid_poses";
  let job: ConformerJob = {
    id: crypto.randomUUID(), title: alignment ? "Align poses" : `${request.method} energy and charges`,
    operation: alignment ? "alignment" : "semiempirical", inputTitle,
    status: "running", startedAt: Date.now(), cancelable: false,
    progress: "Preparing calculation…",
  };
  const update = (patch: Partial<ConformerJob>) => {
    job = { ...job, ...patch };
    publishConformerJob(job);
  };
  const onProgress = new Channel<AnalysisProgress>();
  onProgress.onmessage = (progress) => update({
    durableJobId: progress.jobId, cancelable: true,
    progress: `${progress.completed} of ${progress.total} molecules completed`,
    reportPath: progress.partialReportPath ?? job.reportPath,
  });
  update({});
  try {
    const result = await invoke<T>(command, { request, onProgress });
    update({ status: "success", cancelable: false, completedAt: Date.now(),
      backend: result.backend === "nativeCpuReference" ? "referenceCpu" : "nativeMetal",
      reportPath: result.reportPath, progress: "Calculation completed" });
    return result;
  } catch (error) {
    const latest = job.durableJobId
      ? await invoke<{ state: string }>("compute_get_job", { jobId: job.durableJobId }).catch(() => null)
      : null;
    const cancelled = latest?.state === "cancelled" || !!error && typeof error === "object" && "code" in error && error.code === "Cancelled";
    const message = error instanceof Error ? error.message
      : error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
    update({ status: cancelled ? "cancelled" : "failed", cancelable: false, completedAt: Date.now(),
      error: message, progress: cancelled ? (job.reportPath ? "Cancelled; completed rows are in the partial report" : "Calculation cancelled") : "Calculation failed" });
    if (cancelled) throw new DOMException(message, "AbortError");
    throw error;
  }
}
