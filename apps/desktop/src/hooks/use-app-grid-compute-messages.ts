import { useCallback, useRef } from "react";
import { computeErrorMessage, runClusterWorkflow } from "../lib/compute-cluster";
import { isTauriRuntime } from "../lib/tauri";
import type { PostMessageToViewerSource } from "../lib/viewer-bridge";

type GridComputeMessageBody = Record<string, unknown> | null | undefined;
type PushStatus = (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;

type UseAppGridComputeMessagesOptions = {
  postMessageToViewerSource: PostMessageToViewerSource;
  pushStatus: PushStatus;
};

export function useAppGridComputeMessages({
  postMessageToViewerSource,
  pushStatus,
}: UseAppGridComputeMessagesOptions) {
  const runningDocumentsRef = useRef(new Set<string>());

  const handleGridComputeMessage = useCallback((
    body: GridComputeMessageBody,
    source: MessageEventSource | null,
  ) => {
    if (body?.type !== "clusterMolecules") return false;
    const documentId = typeof body.documentId === "string" ? body.documentId.trim() : "";
    if (!documentId) return true;
    if (!isTauriRuntime()) {
      postGridComputeMessage(postMessageToViewerSource, source, documentId, {
        type: "gridClusterError",
        error: "Native clustering is available only in the Burrete desktop runtime.",
      });
      pushStatus("Native clustering is unavailable outside the desktop runtime.", "error");
      return true;
    }
    if (runningDocumentsRef.current.has(documentId)) {
      postGridComputeMessage(postMessageToViewerSource, source, documentId, {
        type: "gridClusterError",
        error: "A clustering job is already running for this Grid.",
      });
      return true;
    }

    const sourceIndexes = Array.isArray(body.sourceIndexes)
      ? body.sourceIndexes.filter((value): value is number => Number.isSafeInteger(value) && value >= 0)
      : [];
    const cutoff = typeof body.cutoff === "number" ? body.cutoff : 0.7;
    runningDocumentsRef.current.add(documentId);
    postGridComputeMessage(postMessageToViewerSource, source, documentId, {
      type: "gridClusterStarted",
      selectedCount: sourceIndexes.length || null,
      cutoff,
    });
    pushStatus(sourceIndexes.length
      ? `Clustering ${sourceIndexes.length.toLocaleString()} selected molecules...`
      : "Clustering all molecules...");

    void runClusterWorkflow(documentId, sourceIndexes, cutoff, (progress) => {
      const completed = progress.completedRecords ?? 0;
      const total = progress.totalRecords ?? 0;
      postGridComputeMessage(postMessageToViewerSource, source, documentId, {
        type: "gridClusterProgress",
        phase: progress.phase,
        completedRecords: completed,
        totalRecords: total,
        jobId: progress.job.jobId,
        jobState: progress.job.state,
      });
      if (progress.phase === "fingerprints" && total > 0) {
        pushStatus(`Calculating fingerprints: ${completed.toLocaleString()} / ${total.toLocaleString()}...`);
      } else if (progress.phase === "similarity") {
        pushStatus("Building the blockwise Tanimoto graph and Butina clusters...");
      } else if (progress.phase === "publishing") {
        pushStatus("Publishing cluster results and updating Grid...");
      }
    }).then((result) => {
      const backendLabel = result.backend === "nativeMetal" ? "Metal GPU" : "reference CPU";
      postGridComputeMessage(postMessageToViewerSource, source, documentId, {
        type: "gridClusterFinished",
        jobId: result.job.jobId,
        artifactId: result.artifactId,
        artifactManifestSha256: result.artifactManifestSha256,
        backend: result.backend,
        clusterCount: result.clusterCount,
        successfulRecords: result.successfulRecords,
        failedRecords: result.failedRecords,
        gridApplied: result.gridApplied,
        gridWarning: result.gridWarning,
      });
      const message = `Clustering finished: ${result.clusterCount.toLocaleString()} clusters via ${backendLabel}.`;
      pushStatus(message, result.gridApplied ? "success" : "error", result.gridWarning ? [result.gridWarning] : undefined);
    }).catch((error) => {
      const message = computeErrorMessage(error);
      postGridComputeMessage(postMessageToViewerSource, source, documentId, {
        type: "gridClusterError",
        error: message,
      });
      pushStatus(`Clustering failed: ${message}`, "error");
    }).finally(() => {
      runningDocumentsRef.current.delete(documentId);
    });
    return true;
  }, [postMessageToViewerSource, pushStatus]);

  return { handleGridComputeMessage };
}

function postGridComputeMessage(
  postMessageToViewerSource: PostMessageToViewerSource,
  source: MessageEventSource | null,
  documentId: string,
  body: Record<string, unknown>,
) {
  postMessageToViewerSource(source, {
    source: "burrete-grid-host",
    body: { documentId, ...body },
  });
}
