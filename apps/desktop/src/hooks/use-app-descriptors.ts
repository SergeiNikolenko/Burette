import { useCallback, useRef, useState } from "react";

import {
  calculateGridDescriptors as runGridDescriptorCalculation,
  gridDescriptorJobStatus,
  type DescriptorSourcePayload,
  type GridDescriptorControls,
  type GridDescriptorJobStatus,
  type GridDescriptorResultRow,
  type GridDescriptorRunOptions,
} from "../lib/descriptors";
import { activeViewerIframeForDocument } from "../lib/viewer-bridge";
import type { ViewerDocument } from "../types";

export const GRID_DESCRIPTOR_JOB_EVENT = "burette-grid-descriptor-job";

// The desktop command only starts the worker thread and returns immediately, so
// the job has to be followed to know when it finished, failed, or wrote columns.
const GRID_DESCRIPTOR_POLL_MS = 1200;

type UseAppDescriptorsArgs = {
  documents: ViewerDocument[];
  pushStatus: (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;
};

export function useAppDescriptors({
  documents,
  pushStatus,
}: UseAppDescriptorsArgs) {
  const [descriptorSource, setDescriptorSource] = useState<DescriptorSourcePayload | null>(null);
  // Re-running the menu command against a collection that is already being
  // processed returns the running job rather than starting a second one, so a
  // second follower would only duplicate every status event.
  const followedJobsRef = useRef(new Set<string>());

  const openDescriptorSource = useCallback((source: DescriptorSourcePayload) => {
    setDescriptorSource(source);
    pushStatus(`Prepared descriptor source for ${source.sourceLabel}`);
  }, [pushStatus]);

  const clearDescriptorSource = useCallback(() => {
    setDescriptorSource(null);
  }, []);

  const applyGridDescriptorControls = useCallback((documentId: string, controls: GridDescriptorControls) => {
    const iframe = activeViewerIframeForDocument(documentId, "grid2d");
    if (!iframe?.contentWindow) {
      pushStatus("Grid descriptor target is not open.", "error");
      return;
    }
    iframe.contentWindow.postMessage({
      source: "burette-grid-host",
      body: {
        type: "gridDescriptorControls",
        documentId,
        filters: controls.filters,
        descriptorSort: controls.descriptorSort,
      },
    }, "*");
    pushStatus("Applied descriptor controls to grid");
  }, [pushStatus]);

  const applyGridDescriptorResults = useCallback((documentId: string, rows: GridDescriptorResultRow[]) => {
    const iframe = activeViewerIframeForDocument(documentId, "grid2d");
    if (!iframe?.contentWindow) {
      pushStatus("Grid descriptor target is not open.", "error");
      return;
    }
    iframe.contentWindow.postMessage({
      source: "burette-grid-host",
      body: {
        type: "gridDescriptorResults",
        documentId,
        rows,
      },
    }, "*");
    pushStatus(`Applied descriptors to ${rows.length.toLocaleString()} grid row${rows.length === 1 ? "" : "s"}`);
  }, [pushStatus]);

  // A desktop run writes descriptor values straight into the collection
  // database, so the grid only learns about the new columns by re-reading a
  // page. Unlike the calls above this one can land long after the run started,
  // when the document may no longer be on screen - the values keep until the
  // grid is next paged, so a missing frame is not an error worth reporting.
  const notifyGridDescriptorRunFinished = useCallback((documentId: string, descriptorIdCount: number) => {
    activeViewerIframeForDocument(documentId, "grid2d")?.contentWindow?.postMessage({
      source: "burette-grid-host",
      body: {
        type: "gridDescriptorFinished",
        documentId,
        descriptorIdCount,
      },
    }, "*");
  }, []);

  // Follows a started run to completion. Every snapshot is republished so the
  // status row in the Info panel tracks the worker, and the run only reports an
  // outcome once - a failed run raises the error toast that a silent job never
  // could.
  const followGridDescriptorJob = useCallback(async (documentId: string) => {
    if (followedJobsRef.current.has(documentId)) return;
    followedJobsRef.current.add(documentId);
    try {
      for (;;) {
        await new Promise((resolve) => window.setTimeout(resolve, GRID_DESCRIPTOR_POLL_MS));
        const status = await gridDescriptorJobStatus(documentId);
        publishGridDescriptorJob(status);
        if (status.running) continue;
        // A run that fails or is cancelled part way still leaves the batches it
        // already stored, so the grid is told to re-read whenever anything landed.
        if (status.calculatedRows > 0) {
          notifyGridDescriptorRunFinished(documentId, status.summary?.descriptorIdCount ?? 0);
        }
        pushStatus(
          status.message || "Descriptor calculation finished",
          status.status === "failed" ? "error" : status.status === "completed" ? "success" : "info",
        );
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      publishGridDescriptorJob(failedGridDescriptorJob(documentId, message));
      pushStatus(`Descriptor calculation failed: ${message}`, "error");
    } finally {
      followedJobsRef.current.delete(documentId);
    }
  }, [notifyGridDescriptorRunFinished, pushStatus]);

  const calculateGridDescriptors = useCallback((documentId: string, options: GridDescriptorRunOptions = {}) => {
    const targetDocument = documents.find((document) => document.id === documentId);
    if (!targetDocument) {
      pushStatus("Grid descriptor target is not open.", "error");
      return;
    }
    const rowIndexes = Array.isArray(options.rowIndexes)
      ? Array.from(new Set(options.rowIndexes
        .map((index) => Math.trunc(Number(index)))
        .filter((index) => Number.isFinite(index) && index >= 0)))
        .sort((left, right) => left - right)
      : [];
    const targetCount = rowIndexes.length;
    publishGridDescriptorJob({
      documentId,
      status: "running",
      running: true,
      totalRows: targetCount,
      processedRows: 0,
      calculatedRows: 0,
      failedRows: 0,
      message: targetCount
        ? `Starting descriptor calculation for ${targetCount.toLocaleString()} selected molecule${targetCount === 1 ? "" : "s"}...`
        : "Starting descriptor calculation for all molecules...",
      startedAtMs: Date.now(),
      finishedAtMs: null,
      summary: null,
    });
    pushStatus(targetCount
      ? `Calculating descriptors for ${targetCount.toLocaleString()} selected molecule${targetCount === 1 ? "" : "s"}`
      : "Calculating descriptors for all molecules");
    void runGridDescriptorCalculation(documentId, targetDocument.path, targetCount ? { rowIndexes } : {})
      .then((status) => {
        publishGridDescriptorJob(status);
        // Browser-dev computes inline and answers with the finished rows; the
        // desktop command only starts a worker and has to be followed.
        if (status.rows?.length) applyGridDescriptorResults(documentId, status.rows);
        if (status.running) {
          void followGridDescriptorJob(documentId);
          return;
        }
        pushStatus(status.message || "Descriptor calculation finished", status.status === "failed" ? "error" : "success");
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        publishGridDescriptorJob(failedGridDescriptorJob(documentId, message, targetCount));
        pushStatus(`Descriptor calculation failed: ${message}`, "error");
      });
  }, [applyGridDescriptorResults, documents, followGridDescriptorJob, pushStatus]);

  return {
    applyGridDescriptorControls,
    applyGridDescriptorResults,
    calculateGridDescriptors,
    clearDescriptorSource,
    descriptorSource,
    openDescriptorSource,
  };
}

function publishGridDescriptorJob(status: GridDescriptorJobStatus) {
  window.dispatchEvent(new CustomEvent<GridDescriptorJobStatus>(GRID_DESCRIPTOR_JOB_EVENT, { detail: status }));
}

function failedGridDescriptorJob(documentId: string, message: string, totalRows = 0): GridDescriptorJobStatus {
  return {
    documentId,
    status: "failed",
    running: false,
    totalRows,
    processedRows: 0,
    calculatedRows: 0,
    failedRows: 0,
    message,
    startedAtMs: Date.now(),
    finishedAtMs: Date.now(),
    summary: null,
  };
}
