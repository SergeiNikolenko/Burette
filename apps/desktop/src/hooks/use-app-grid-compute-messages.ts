import { useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  type ClusterFilteredScope,
  cancelComputeJob,
  computeErrorMessage,
  exportClusterRepresentatives,
  findSimilarMolecules,
  runClusterWorkflow,
} from "../lib/compute-cluster";
import { isTauriRuntime } from "../lib/tauri";
import { normalizeAppError } from "../lib/app-error";
import type { PostMessageToViewerSource } from "../lib/viewer-bridge";

type GridComputeMessageBody = Record<string, unknown> | null | undefined;
type PushStatus = (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;

type UseAppGridComputeMessagesOptions = {
  openTextDocuments: (paths: string[], options?: { background?: boolean }) => void | Promise<unknown>;
  postMessageToViewerSource: PostMessageToViewerSource;
  pushStatus: PushStatus;
};

type ActiveClusterRun = {
  controller: AbortController;
  jobId: string | null;
};

type ComputeCapabilityReport = {
  availability: "available" | "degraded" | "unavailable";
  device?: { name?: string; unifiedMemory?: boolean } | null;
  runtime?: { version?: string; metallibSha256?: string | null } | null;
  capabilities?: Array<{ backend?: string; available?: boolean }>;
  reasons?: Array<{ code?: string; message?: string }>;
};

export function useAppGridComputeMessages({
  openTextDocuments,
  postMessageToViewerSource,
  pushStatus,
}: UseAppGridComputeMessagesOptions) {
  const runningDocumentsRef = useRef(new Set<string>());
  const activeClusterRunsRef = useRef(new Map<string, ActiveClusterRun>());
  const exportingDocumentsRef = useRef(new Set<string>());
  const searchingDocumentsRef = useRef(new Set<string>());

  const handleGridComputeMessage = useCallback((
    body: GridComputeMessageBody,
    source: MessageEventSource | null,
  ) => {
    if (body?.type === "requestComputeCapabilities") {
      const documentId = typeof body.documentId === "string" ? body.documentId.trim() : "";
      if (!documentId) return true;
      if (!isTauriRuntime()) {
        postGridComputeMessage(postMessageToViewerSource, source, documentId, {
          type: "gridComputeCapabilitiesError",
          error: "Native compute is available only in the Burrete desktop runtime.",
        });
        return true;
      }
      void invoke<ComputeCapabilityReport>("compute_capabilities").then((report) => {
        postGridComputeMessage(postMessageToViewerSource, source, documentId, {
          type: "gridComputeCapabilities",
          report,
        });
      }).catch((error) => {
        const message = normalizeAppError(error, "Compute capability check failed.");
        postGridComputeMessage(postMessageToViewerSource, source, documentId, {
          type: "gridComputeCapabilitiesError",
          error: message,
        });
        pushStatus(`Compute capability check failed: ${message}`, "error");
      });
      return true;
    }
    if (body?.type === "cancelClusterMolecules") {
      const documentId = typeof body.documentId === "string" ? body.documentId.trim() : "";
      if (!documentId) return true;
      const active = activeClusterRunsRef.current.get(documentId);
      if (!active) {
        postGridComputeMessage(postMessageToViewerSource, source, documentId, {
          type: "gridClusterCancellationError",
          error: "No active clustering job is available to cancel.",
        });
        return true;
      }
      postGridComputeMessage(postMessageToViewerSource, source, documentId, {
        type: "gridClusterCancellationRequested",
      });
      pushStatus("Cancelling clustering at the current durable stage boundary...");
      if (!active.jobId) {
        active.controller.abort();
        return true;
      }
      void cancelComputeJob(active.jobId).then((cancelled) => {
        if (cancelled) active.controller.abort();
      }).catch((error) => {
        const message = computeErrorMessage(error);
        postGridComputeMessage(postMessageToViewerSource, source, documentId, {
          type: "gridClusterCancellationError",
          error: message,
        });
        pushStatus(`Clustering cancellation failed: ${message}`, "error");
      });
      return true;
    }
    if (body?.type === "findSimilarMolecules") {
      const documentId = typeof body.documentId === "string" ? body.documentId.trim() : "";
      const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
      const querySourceIndex = typeof body.querySourceIndex === "number" ? body.querySourceIndex : -1;
      if (!documentId || !jobId || !Number.isSafeInteger(querySourceIndex) || querySourceIndex < 0) {
        if (documentId) {
          postGridComputeMessage(postMessageToViewerSource, source, documentId, {
            type: "gridSimilaritySearchError",
            error: "Similarity search requires one valid query molecule and a successful clustering run.",
          });
        }
        return true;
      }
      if (!isTauriRuntime()) {
        postGridComputeMessage(postMessageToViewerSource, source, documentId, {
          type: "gridSimilaritySearchError",
          error: "Native similarity search is available only in the Burrete desktop runtime.",
        });
        pushStatus("Native similarity search is unavailable outside the desktop runtime.", "error");
        return true;
      }
      if (
        runningDocumentsRef.current.has(documentId)
        || searchingDocumentsRef.current.has(documentId)
      ) {
        postGridComputeMessage(postMessageToViewerSource, source, documentId, {
          type: "gridSimilaritySearchError",
          error: "Another molecular analysis is already running for this Grid.",
        });
        return true;
      }

      const cutoff = typeof body.cutoff === "number" ? body.cutoff : 0.7;
      const topK = typeof body.topK === "number" && Number.isSafeInteger(body.topK)
        ? Math.max(1, Math.min(500, body.topK))
        : 50;
      searchingDocumentsRef.current.add(documentId);
      postGridComputeMessage(postMessageToViewerSource, source, documentId, {
        type: "gridSimilaritySearchStarted",
        jobId,
        querySourceIndex,
        cutoff,
        topK,
      });
      pushStatus(
        `Searching the verified fingerprint library for up to ${topK.toLocaleString()} matches...`,
      );

      void findSimilarMolecules(jobId, querySourceIndex, cutoff, topK).then((result) => {
        const backendLabel = result.backend === "nativeMetal" ? "Metal GPU" : "reference CPU";
        postGridComputeMessage(postMessageToViewerSource, source, documentId, {
          type: "gridSimilaritySearchFinished",
          ...result,
        });
        const displayed = result.matches.length;
        const message = `Similarity search found ${displayed.toLocaleString()} displayed match${
          displayed === 1 ? "" : "es"
        } via ${backendLabel}.`;
        const warnings = [result.gridWarning, result.fallbackReason].filter(
          (value): value is string => typeof value === "string" && Boolean(value.trim()),
        );
        pushStatus(
          message,
          result.gridApplied ? "success" : "error",
          warnings.length ? warnings : undefined,
        );
      }).catch((error) => {
        const message = computeErrorMessage(error);
        postGridComputeMessage(postMessageToViewerSource, source, documentId, {
          type: "gridSimilaritySearchError",
          error: message,
        });
        pushStatus(`Similarity search failed: ${message}`, "error");
      }).finally(() => {
        searchingDocumentsRef.current.delete(documentId);
      });
      return true;
    }
    if (body?.type === "exportClusterRepresentatives") {
      const documentId = typeof body.documentId === "string" ? body.documentId.trim() : "";
      const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
      if (!documentId || !jobId) return true;
      if (!isTauriRuntime()) {
        postGridComputeMessage(postMessageToViewerSource, source, documentId, {
          type: "gridClusterRepresentativesExportError",
          error: "Representative export is available only in the Burrete desktop runtime.",
        });
        return true;
      }
      if (exportingDocumentsRef.current.has(documentId)) {
        postGridComputeMessage(postMessageToViewerSource, source, documentId, {
          type: "gridClusterRepresentativesExportError",
          error: "A representative export is already running for this Grid.",
        });
        return true;
      }
      exportingDocumentsRef.current.add(documentId);
      postGridComputeMessage(postMessageToViewerSource, source, documentId, {
        type: "gridClusterRepresentativesExportStarted",
        jobId,
      });
      pushStatus("Choose a folder for the immutable diverse-representative bundle...");
      void (async () => {
        const outputDirectory = await open({
          directory: true,
          multiple: false,
          title: "Export diverse representatives",
        });
        if (typeof outputDirectory !== "string" || !outputDirectory) {
          postGridComputeMessage(postMessageToViewerSource, source, documentId, {
            type: "gridClusterRepresentativesExportCancelled",
          });
          return;
        }
        const collectionName = typeof body.collectionName === "string" && body.collectionName.trim()
          ? body.collectionName.trim()
          : "molecules";
        const result = await exportClusterRepresentatives(jobId, outputDirectory, collectionName);
        postGridComputeMessage(postMessageToViewerSource, source, documentId, {
          type: "gridClusterRepresentativesExportFinished",
          ...result,
        });
        pushStatus(
          `Exported ${result.representativeCount.toLocaleString()} diverse representatives with provenance.`,
          "success",
          [result.bundlePath],
        );
      })().catch((error) => {
        const message = computeErrorMessage(error);
        postGridComputeMessage(postMessageToViewerSource, source, documentId, {
          type: "gridClusterRepresentativesExportError",
          error: message,
        });
        pushStatus(`Representative export failed: ${message}`, "error");
      }).finally(() => {
        exportingDocumentsRef.current.delete(documentId);
      });
      return true;
    }
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
    if (
      runningDocumentsRef.current.has(documentId)
      || searchingDocumentsRef.current.has(documentId)
    ) {
      postGridComputeMessage(postMessageToViewerSource, source, documentId, {
        type: "gridClusterError",
        error: "Another molecular analysis is already running for this Grid.",
      });
      return true;
    }

    const sourceIndexes = Array.isArray(body.sourceIndexes)
      ? body.sourceIndexes.filter((value): value is number => Number.isSafeInteger(value) && value >= 0)
      : [];
    const filteredScope = sourceIndexes.length === 0
      ? parseClusterFilteredScope(body.filteredScope)
      : null;
    const cutoff = typeof body.cutoff === "number" ? body.cutoff : 0.7;
    const activeRun: ActiveClusterRun = {
      controller: new AbortController(),
      jobId: null,
    };
    runningDocumentsRef.current.add(documentId);
    activeClusterRunsRef.current.set(documentId, activeRun);
    postGridComputeMessage(postMessageToViewerSource, source, documentId, {
      type: "gridClusterStarted",
      selectedCount: sourceIndexes.length || null,
      cutoff,
    });
    pushStatus(sourceIndexes.length
      ? `Clustering ${sourceIndexes.length.toLocaleString()} selected molecules...`
      : filteredScope
      ? "Clustering the current filtered molecule scope..."
      : "Clustering all molecules...");

    void runClusterWorkflow(documentId, sourceIndexes, cutoff, (progress) => {
      activeRun.jobId = progress.job.jobId;
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
    }, filteredScope, activeRun.controller.signal).then((result) => {
      void openTextDocuments([result.reportPath], { background: true });
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
      if (activeRun.controller.signal.aborted) {
        postGridComputeMessage(postMessageToViewerSource, source, documentId, {
          type: "gridClusterCancelled",
        });
        pushStatus("Clustering cancelled.", "success");
        return;
      }
      const message = computeErrorMessage(error);
      postGridComputeMessage(postMessageToViewerSource, source, documentId, {
        type: "gridClusterError",
        error: message,
      });
      pushStatus(`Clustering failed: ${message}`, "error");
    }).finally(() => {
      runningDocumentsRef.current.delete(documentId);
      activeClusterRunsRef.current.delete(documentId);
    });
    return true;
  }, [openTextDocuments, postMessageToViewerSource, pushStatus]);

  return { handleGridComputeMessage };
}

function parseClusterFilteredScope(value: unknown): ClusterFilteredScope | null {
  if (!value || typeof value !== "object") return null;
  const scope = value as Record<string, unknown>;
  const query = scope.query;
  if (
    scope.kind !== "filtered"
    || !query
    || typeof query !== "object"
    || (query as Record<string, unknown>).kind !== "text"
    || typeof (query as Record<string, unknown>).text !== "string"
    || !Array.isArray(scope.columnFilters)
    || !Array.isArray(scope.descriptorFilters)
    || !Array.isArray(scope.analysisFilters)
  ) {
    return null;
  }
  return value as ClusterFilteredScope;
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
