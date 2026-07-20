import { useCallback, useState } from "react";

import {
  calculateGridDescriptors as runGridDescriptorCalculation,
  type DescriptorSourcePayload,
  type GridDescriptorControls,
  type GridDescriptorJobStatus,
  type GridDescriptorResultRow,
  type GridDescriptorRunOptions,
} from "../lib/descriptors";
import { activeViewerIframeForDocument } from "../lib/viewer-bridge";
import type { ViewerDocument } from "../types";

const GRID_DESCRIPTOR_JOB_EVENT = "burrete-grid-descriptor-job";

type UseAppDescriptorsArgs = {
  documents: ViewerDocument[];
  pushStatus: (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;
};

export function useAppDescriptors({
  documents,
  pushStatus,
}: UseAppDescriptorsArgs) {
  const [descriptorSource, setDescriptorSource] = useState<DescriptorSourcePayload | null>(null);

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
      source: "burrete-grid-host",
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
      source: "burrete-grid-host",
      body: {
        type: "gridDescriptorResults",
        documentId,
        rows,
      },
    }, "*");
    pushStatus(`Applied descriptors to ${rows.length.toLocaleString()} grid row${rows.length === 1 ? "" : "s"}`);
  }, [pushStatus]);

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
        if (status.rows?.length) applyGridDescriptorResults(documentId, status.rows);
        if (!status.running) {
          pushStatus(status.message || "Descriptor calculation finished", status.status === "failed" ? "error" : "success");
        }
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        publishGridDescriptorJob({
          documentId,
          status: "failed",
          running: false,
          totalRows: targetCount,
          processedRows: 0,
          calculatedRows: 0,
          failedRows: 0,
          message,
          startedAtMs: Date.now(),
          finishedAtMs: Date.now(),
          summary: null,
        });
        pushStatus(`Descriptor calculation failed: ${message}`, "error");
      });
  }, [applyGridDescriptorResults, documents, pushStatus]);

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
