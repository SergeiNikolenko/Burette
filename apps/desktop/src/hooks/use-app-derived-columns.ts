import { useCallback, useEffect, useRef, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";

import type { GridColumnChoice, StatusKind } from "../components/types";
import {
  closestReferenceMatch,
  compileSubstructureQuery,
  computeDerivedValue,
  computeRowProperties,
  createReactionRunner,
  decomposeRGroupsInRuntime,
  DERIVED_COLUMN_KINDS,
  countSubstructureMatches,
  fetchDerivedSourceRows,
  loadDerivedEngines,
  morganFingerprint,
  parseReferenceStructures,
  PROPERTY_COLUMNS,
  runReactionOnRow,
  rgroupRuntimeStatus,
  SCAFFOLD_COUNT_COLUMN,
  storeDerivedValues,
  type DerivedColumnKind,
  type DerivedComputeRow,
  type DerivedStoreValue,
  type PropertyComputeResult,
  type PropertyRunOptions,
  type ReferenceFingerprint,
} from "../lib/derived-columns";
import { compileFormula } from "../lib/formula-eval.mjs";
import { joinColumnValues } from "../lib/merge-columns.mjs";
import { readStructureText } from "../lib/structure-text";
import { isTauriRuntime } from "../lib/tauri";
import { activeViewerIframeForDocument } from "../lib/viewer-bridge";
import type { DerivedColumnJob, ViewerDocument } from "../types";

const DERIVED_SOURCE_BATCH = 200;
const DERIVED_JOB_HISTORY_LIMIT = 20;
const DERIVED_STORE_BATCH = 2_000;
const GRID_RECORDS_TIMEOUT_MS = 15_000;
// A reference set is meant to be a series, not a screening library: past this
// the row-by-row scan stops being interactive, so the run says so instead of
// hanging the webview.
const REFERENCE_STRUCTURE_LIMIT = 5_000;
const REFERENCE_FILE_MAX_BYTES = 32 * 1024 * 1024;
// rdRGroupDecomposition aligns one core across the whole set at once, so the
// molecules travel to Python in a single payload; the command enforces the
// same ceiling on its side.
const RGROUP_ROW_LIMIT = 5_000;
// What Merge Equivalent Rows puts between values that differ. Two measurements
// of the same molecule are both worth keeping, so they are joined rather than
// one of them being chosen.
const MERGED_VALUE_SEPARATOR = "; ";

type PushStatus = (message: string, kind?: StatusKind, details?: string[]) => void;

// Browser-dev has no collection database; the grid iframe owns the parsed rows
// and already answers chemicalSpaceRequestRecords, so a property run there
// borrows that channel and applies results back in memory.
export function requestGridRecords(documentId: string): Promise<Array<DerivedComputeRow & { index: number }>> {
  return new Promise((resolve, reject) => {
    const iframe = activeViewerIframeForDocument(documentId, "grid2d");
    if (!iframe?.contentWindow) {
      reject(new Error("Grid is not open."));
      return;
    }
    const requestId = `derived-records-${crypto.randomUUID()}`;
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("The grid did not provide molecule records."));
    }, GRID_RECORDS_TIMEOUT_MS);
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { source?: unknown; body?: Record<string, unknown> } | null;
      if (data?.source !== "burette-grid" || data.body?.type !== "chemicalSpaceRecords" || data.body?.requestId !== requestId) return;
      cleanup();
      const records = Array.isArray(data.body.records) ? data.body.records : [];
      resolve(records.flatMap((value) => {
        const record = value as { sourceRecordId?: unknown; format?: unknown; input?: unknown };
        const index = Number(record.sourceRecordId);
        const input = typeof record.input === "string" ? record.input : "";
        if (!Number.isSafeInteger(index) || index < 0 || !input) return [];
        return [{
          index,
          smiles: record.format === "smiles" ? input : null,
          molblock: record.format === "molblock" ? input : null,
        }];
      }));
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
    };
    window.addEventListener("message", onMessage);
    iframe.contentWindow.postMessage({
      source: "burette-grid-host",
      body: { type: "chemicalSpaceRequestRecords", requestId, documentId },
    }, "*");
  });
}

// The grid answers with a numeric column's values keyed by row index; the same
// channel the chemical space and the correlation matrix use.
// Merge Columns joins whatever the cells say, so it reads display text rather
// than the numeric view - the numeric channel drops every non-number, which for
// a name or an identifier column is the whole column.
function requestGridColumnText(documentId: string, columnId: string): Promise<Map<number, string>> {
  return new Promise((resolve, reject) => {
    const iframe = activeViewerIframeForDocument(documentId, "grid2d");
    if (!iframe?.contentWindow) {
      reject(new Error("Grid is not open."));
      return;
    }
    const requestId = `merge-text-${crypto.randomUUID()}`;
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`The grid did not return values for ${columnId}.`));
    }, GRID_RECORDS_TIMEOUT_MS);
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { source?: unknown; body?: Record<string, unknown> } | null;
      if (data?.source !== "burette-grid"
        || data.body?.type !== "chemicalSpaceColumnText"
        || data.body?.requestId !== requestId) return;
      cleanup();
      const values = Array.isArray(data.body.values) ? data.body.values : [];
      resolve(new Map(values
        .filter((entry): entry is [number, string] => Array.isArray(entry) && entry.length === 2)
        .map(([rowIndex, value]) => [Number(rowIndex), String(value)])));
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
    };
    window.addEventListener("message", onMessage);
    iframe.contentWindow.postMessage({
      source: "burette-grid-host",
      body: { type: "chemicalSpaceRequestColumnText", requestId, documentId, columnId },
    }, "*");
  });
}

// The Info panel's filter model is empty for a paged collection on purpose - it
// would describe one page - so the dialogs that pick a column ask the grid for
// the catalog its own table renders, which exists in both modes.
export function requestGridColumns(documentId: string): Promise<GridColumnChoice[]> {
  return new Promise((resolve, reject) => {
    const iframe = activeViewerIframeForDocument(documentId, "grid2d");
    if (!iframe?.contentWindow) {
      reject(new Error("Grid is not open."));
      return;
    }
    const requestId = `grid-columns-${crypto.randomUUID()}`;
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("The grid did not list its columns."));
    }, GRID_RECORDS_TIMEOUT_MS);
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { source?: unknown; body?: Record<string, unknown> } | null;
      if (data?.source !== "burette-grid"
        || data.body?.type !== "chemicalSpaceColumns"
        || data.body?.requestId !== requestId) return;
      cleanup();
      const columns = Array.isArray(data.body.columns) ? data.body.columns : [];
      resolve(columns.flatMap((value) => {
        const column = value as { id?: unknown; label?: unknown; type?: unknown; kind?: unknown };
        if (typeof column.id !== "string" || typeof column.label !== "string") return [];
        return [{
          id: column.id,
          label: column.label,
          type: column.type === "number" ? "number" as const : "text" as const,
          kind: typeof column.kind === "string" ? column.kind : "property",
        }];
      }));
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
    };
    window.addEventListener("message", onMessage);
    iframe.contentWindow.postMessage({
      source: "burette-grid-host",
      body: { type: "chemicalSpaceRequestColumns", requestId, documentId, includeAllColumns: true },
    }, "*");
  });
}

function requestGridColumnValues(documentId: string, columnId: string): Promise<Map<number, number>> {
  return new Promise((resolve, reject) => {
    const iframe = activeViewerIframeForDocument(documentId, "grid2d");
    if (!iframe?.contentWindow) {
      reject(new Error("Grid is not open."));
      return;
    }
    const requestId = `calc-values-${crypto.randomUUID()}`;
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`The grid did not return values for ${columnId}.`));
    }, GRID_RECORDS_TIMEOUT_MS);
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { source?: unknown; body?: Record<string, unknown> } | null;
      if (data?.source !== "burette-grid"
        || data.body?.type !== "chemicalSpaceColumnValues"
        || data.body?.requestId !== requestId) return;
      cleanup();
      const values = Array.isArray(data.body.values) ? data.body.values : [];
      resolve(new Map(values
        .filter((entry): entry is [number, number] => Array.isArray(entry) && entry.length === 2)
        .map(([rowIndex, value]) => [Number(rowIndex), Number(value)])));
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
    };
    window.addEventListener("message", onMessage);
    iframe.contentWindow.postMessage({
      source: "burette-grid-host",
      body: { type: "chemicalSpaceRequestColumnValues", requestId, documentId, columnId },
    }, "*");
  });
}

type StructureIdentityGroups = {
  // One entry per molecule that occurs more than once: the row that stays and
  // the rows that are equivalent to it, in the order the collection lists them.
  groups: Array<{ keepIndex: number; mergeIndexes: number[] }>;
  processedRows: number;
  failedRows: number;
};

// The identity behind both Delete Rows ▸ Duplicate Molecules and Merge
// Equivalent Rows: two rows are the same molecule when their InChI-Keys match.
// A structure with no comparable key is never called equivalent to anything -
// dropping unparseable rows would be data loss - and is counted as failed.
async function collectStructureIdentityGroups(
  documentId: string,
  updateJob: (patch: Partial<DerivedColumnJob>) => void,
): Promise<StructureIdentityGroups> {
  const engines = await loadDerivedEngines();
  const keepByKey = new Map<string, number>();
  const membersByKeep = new Map<number, number[]>();
  let processedRows = 0;
  let failedRows = 0;
  const consider = (row: DerivedComputeRow & { sourceIndex: number }) => {
    processedRows += 1;
    const key = computeDerivedValue("inchikey", engines, row).valueText;
    if (!key) {
      failedRows += 1;
      return;
    }
    const keepIndex = keepByKey.get(key);
    if (keepIndex === undefined) {
      keepByKey.set(key, row.sourceIndex);
      return;
    }
    const members = membersByKeep.get(keepIndex) ?? [];
    members.push(row.sourceIndex);
    membersByKeep.set(keepIndex, members);
  };
  if (isTauriRuntime()) {
    let afterSourceIndex = -1;
    for (;;) {
      const batch = await fetchDerivedSourceRows(documentId, afterSourceIndex, DERIVED_SOURCE_BATCH);
      if (processedRows === 0) updateJob({ totalRows: batch.totalRows });
      if (batch.rows.length === 0) break;
      for (const row of batch.rows) consider({ ...row, sourceIndex: row.sourceIndex });
      afterSourceIndex = batch.rows[batch.rows.length - 1].sourceIndex;
      updateJob({ processedRows, failedRows });
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
  } else {
    const records = await requestGridRecords(documentId);
    updateJob({ totalRows: records.length });
    for (const record of records) consider({ ...record, sourceIndex: record.index });
    updateJob({ processedRows, failedRows });
  }
  return {
    groups: [...membersByKeep].map(([keepIndex, mergeIndexes]) => ({ keepIndex, mergeIndexes })),
    processedRows,
    failedRows,
  };
}

type UseAppDerivedColumnsOptions = {
  documents: ViewerDocument[];
  pushStatus: PushStatus;
};

// Adds a structure-derived column to a grid collection: pages source rows out
// of the collection database, computes values with the in-process engines
// (openchemlib / RDKit WASM), and stores them back through the descriptor
// channel so the grid picks the column up on its next page read. The loop runs
// in the host webview - the same code path a future browser toolbar would use.
export function useAppDerivedColumns({ documents, pushStatus }: UseAppDerivedColumnsOptions) {
  const [derivedColumnJobs, setDerivedColumnJobs] = useState<DerivedColumnJob[]>([]);
  const [rgroupRuntimeAvailable, setRgroupRuntimeAvailable] = useState(false);
  const runningKeysRef = useRef(new Set<string>());

  // Asked once at startup so Decompose R-Groups can be disabled before it is
  // clicked rather than after: the probe launches a Python interpreter, which
  // is far too slow to do while a menu is opening.
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    void rgroupRuntimeStatus()
      .then((status) => { if (!cancelled) setRgroupRuntimeAvailable(status.available); })
      .catch(() => { if (!cancelled) setRgroupRuntimeAvailable(false); });
    return () => { cancelled = true; };
  }, []);

  const clearDerivedColumnJobs = useCallback(() => {
    setDerivedColumnJobs((previous) => previous.filter((job) => job.status === "running"));
  }, []);

  // Mirrors notifyGridDescriptorRunFinished in use-app-descriptors: stored
  // values only reach the desktop grid when it re-reads a page, and column ids
  // ride along with the page payload.
  const notifyGridDerivedRunFinished = useCallback((documentId: string) => {
    activeViewerIframeForDocument(documentId, "grid2d")?.contentWindow?.postMessage({
      source: "burette-grid-host",
      body: {
        type: "gridDescriptorFinished",
        documentId,
        descriptorIdCount: 1,
      },
    }, "*");
  }, []);

  const addDerivedGridColumn = useCallback((documentId: string, kind: DerivedColumnKind) => {
    const targetDocument = documents.find((document) => document.id === documentId);
    const kindInfo = DERIVED_COLUMN_KINDS[kind];
    if (!targetDocument || !kindInfo) {
      pushStatus("Derived column target is not open.", "error");
      return;
    }
    if (!isTauriRuntime()) {
      pushStatus("Add Column runs in the desktop app; browser dev has no collection database.", "error");
      return;
    }
    const runKey = `${documentId}:${kind}`;
    if (runningKeysRef.current.has(runKey)) return;
    runningKeysRef.current.add(runKey);
    const jobId = `derived-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = Date.now();
    const pendingJob: DerivedColumnJob = {
      id: jobId,
      columnLabel: kindInfo.label,
      documentTitle: targetDocument.title,
      status: "running",
      startedAt,
      completedAt: null,
      processedRows: 0,
      failedRows: 0,
      totalRows: 0,
      error: null,
    };
    setDerivedColumnJobs((previous) => [pendingJob, ...previous].slice(0, DERIVED_JOB_HISTORY_LIMIT));
    const updateJob = (patch: Partial<DerivedColumnJob>) => {
      setDerivedColumnJobs((previous) => previous.map((job) => job.id === jobId ? { ...job, ...patch } : job));
    };
    pushStatus(`Adding ${kindInfo.label} column for ${targetDocument.title}`);
    void (async () => {
      try {
        const engines = await loadDerivedEngines();
        let afterSourceIndex = -1;
        let processedRows = 0;
        let failedRows = 0;
        for (;;) {
          const batch = await fetchDerivedSourceRows(documentId, afterSourceIndex, DERIVED_SOURCE_BATCH);
          if (processedRows === 0) updateJob({ totalRows: batch.totalRows });
          if (batch.rows.length === 0) break;
          const values: DerivedStoreValue[] = batch.rows.map((row) => {
            const result = computeDerivedValue(kind, engines, row);
            if (result.errorText) failedRows += 1;
            return {
              rowId: row.rowId,
              valueReal: result.valueReal ?? null,
              valueText: result.valueText ?? null,
              errorText: result.errorText ?? null,
            };
          });
          await storeDerivedValues(documentId, {
            columnId: kindInfo.columnId,
            label: kindInfo.label,
            kind,
          }, values);
          processedRows += batch.rows.length;
          afterSourceIndex = batch.rows[batch.rows.length - 1].sourceIndex;
          updateJob({ processedRows, failedRows });
          // Keep the UI responsive between batches.
          await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
        updateJob({
          status: "success",
          completedAt: Date.now(),
          processedRows,
          failedRows,
        });
        notifyGridDerivedRunFinished(documentId);
        pushStatus(
          failedRows > 0
            ? `Added ${kindInfo.label} for ${(processedRows - failedRows).toLocaleString()} of ${processedRows.toLocaleString()} molecules (${failedRows.toLocaleString()} failed)`
            : `Added ${kindInfo.label} for ${processedRows.toLocaleString()} molecule${processedRows === 1 ? "" : "s"}`,
          failedRows > 0 && failedRows === processedRows ? "error" : "success",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateJob({ status: "failed", completedAt: Date.now(), error: message });
        pushStatus(`Add ${kindInfo.label} column failed: ${message}`, "error");
      } finally {
        runningKeysRef.current.delete(runKey);
      }
    })();
  }, [documents, notifyGridDerivedRunFinished, pushStatus]);

  // Calculate Properties: computes every selected property column in one pass
  // over the collection. Desktop pages rows out of SQLite and persists through
  // the derived store; browser-dev pulls the grid's parsed rows and applies the
  // columns in memory through the descriptor-results message.
  const addPropertyGridColumns = useCallback((documentId: string, propertyIds: string[], options: PropertyRunOptions = {}) => {
    const targetDocument = documents.find((document) => document.id === documentId);
    const properties = propertyIds.filter((id) => PROPERTY_COLUMNS[id]);
    if (!targetDocument || properties.length === 0) {
      pushStatus("Select at least one property to calculate.", "error");
      return;
    }
    const runKey = `${documentId}:properties`;
    if (runningKeysRef.current.has(runKey)) return;
    runningKeysRef.current.add(runKey);
    const jobId = `properties-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const jobLabel = properties.length === 1
      ? PROPERTY_COLUMNS[properties[0]].label
      : `Properties (${properties.length} columns)`;
    const pendingJob: DerivedColumnJob = {
      id: jobId,
      columnLabel: jobLabel,
      documentTitle: targetDocument.title,
      status: "running",
      startedAt: Date.now(),
      completedAt: null,
      processedRows: 0,
      failedRows: 0,
      totalRows: 0,
      error: null,
    };
    setDerivedColumnJobs((previous) => [pendingJob, ...previous].slice(0, DERIVED_JOB_HISTORY_LIMIT));
    const updateJob = (patch: Partial<DerivedColumnJob>) => {
      setDerivedColumnJobs((previous) => previous.map((job) => job.id === jobId ? { ...job, ...patch } : job));
    };
    pushStatus(`Calculating ${properties.length === 1 ? PROPERTY_COLUMNS[properties[0]].label : `${properties.length} properties`} for ${targetDocument.title}`);
    const columnFor = (id: string) => ({
      columnId: id,
      label: PROPERTY_COLUMNS[id].label,
    });
    void (async () => {
      try {
        const engines = await loadDerivedEngines();
        let processedRows = 0;
        let failedRows = 0;
        const countRowFailure = (results: Record<string, PropertyComputeResult>) => {
          if (properties.some((id) => results[id]?.errorText)) failedRows += 1;
        };
        if (isTauriRuntime()) {
          let afterSourceIndex = -1;
          for (;;) {
            const batch = await fetchDerivedSourceRows(documentId, afterSourceIndex, DERIVED_SOURCE_BATCH);
            if (processedRows === 0) updateJob({ totalRows: batch.totalRows });
            if (batch.rows.length === 0) break;
            const rowResults = batch.rows.map((row) => {
              const results = computeRowProperties(engines, row, properties, options);
              countRowFailure(results);
              return results;
            });
            for (const propertyId of properties) {
              const values: DerivedStoreValue[] = batch.rows.map((row, rowIndex) => {
                const result = rowResults[rowIndex][propertyId] ?? { errorText: "Property was not computed" };
                return {
                  rowId: row.rowId,
                  valueReal: result.valueReal ?? null,
                  valueText: result.valueText ?? null,
                  errorText: result.errorText ?? null,
                };
              });
              await storeDerivedValues(documentId, {
                ...columnFor(propertyId),
                kind: "property",
                paramsJson: JSON.stringify({ propertyId, largestFragment: options.largestFragment === true }),
              }, values);
            }
            processedRows += batch.rows.length;
            afterSourceIndex = batch.rows[batch.rows.length - 1].sourceIndex;
            updateJob({ processedRows, failedRows });
            await new Promise((resolve) => window.setTimeout(resolve, 0));
          }
          notifyGridDerivedRunFinished(documentId);
        } else {
          const records = await requestGridRecords(documentId);
          updateJob({ totalRows: records.length });
          // Chunked with yields: the druglikeness predictor alone is a large
          // substructure scan per molecule, and a single synchronous map over a
          // collection freezes the webview for its whole duration.
          const resultRows = [] as Array<{ index: number; descriptors: Record<string, unknown> }>;
          for (let start = 0; start < records.length; start += 50) {
            for (const record of records.slice(start, start + 50)) {
              const results = computeRowProperties(engines, record, properties, options);
              countRowFailure(results);
              processedRows += 1;
              resultRows.push({
                index: record.index,
                descriptors: Object.fromEntries(properties.map((id) => {
                  const result = results[id] ?? { errorText: "Property was not computed" };
                  return [id, {
                    id,
                    label: PROPERTY_COLUMNS[id].label,
                    value: result.valueReal ?? result.valueText ?? null,
                    missingKind: result.errorText ? "error" : null,
                    errorText: result.errorText ?? null,
                  }];
                })),
              });
            }
            updateJob({ processedRows, failedRows });
            await new Promise((resolve) => window.setTimeout(resolve, 0));
          }
          activeViewerIframeForDocument(documentId, "grid2d")?.contentWindow?.postMessage({
            source: "burette-grid-host",
            body: {
              type: "gridDescriptorResults",
              documentId,
              rows: resultRows,
            },
          }, "*");
          updateJob({ processedRows, failedRows });
        }
        updateJob({ status: "success", completedAt: Date.now(), processedRows, failedRows });
        pushStatus(
          failedRows > 0
            ? `Calculated ${properties.length} propert${properties.length === 1 ? "y" : "ies"} for ${(processedRows - failedRows).toLocaleString()} of ${processedRows.toLocaleString()} molecules (${failedRows.toLocaleString()} failed)`
            : `Calculated ${properties.length} propert${properties.length === 1 ? "y" : "ies"} for ${processedRows.toLocaleString()} molecule${processedRows === 1 ? "" : "s"}`,
          failedRows > 0 && failedRows === processedRows ? "error" : "success",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateJob({ status: "failed", completedAt: Date.now(), error: message });
        pushStatus(`Calculate properties failed: ${message}`, "error");
      } finally {
        runningKeysRef.current.delete(runKey);
      }
    })();
  }, [documents, notifyGridDerivedRunFinished, pushStatus]);

  // Perform Reaction: runs one reaction over the collection, taking each row's
  // structure as the first reactant and the dialog's co-reactants as the rest.
  // The parsed reaction is built once for the run and released at the end - it
  // is a WASM object, not a plain value.
  const addReactionProductColumn = useCallback((
    documentId: string,
    label: string,
    smarts: string,
    coReactants: string[],
  ) => {
    const targetDocument = documents.find((document) => document.id === documentId);
    if (!targetDocument) {
      pushStatus("Grid target is not open.", "error");
      return;
    }
    if (!isTauriRuntime()) {
      pushStatus("Perform Reaction runs in the desktop app; browser dev has no collection database.", "error");
      return;
    }
    const runKey = `${documentId}:reaction:${label}`;
    if (runningKeysRef.current.has(runKey)) return;
    runningKeysRef.current.add(runKey);
    const jobId = `reaction-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const pendingJob: DerivedColumnJob = {
      id: jobId,
      columnLabel: label,
      documentTitle: targetDocument.title,
      status: "running",
      startedAt: Date.now(),
      completedAt: null,
      processedRows: 0,
      failedRows: 0,
      totalRows: 0,
      error: null,
    };
    setDerivedColumnJobs((previous) => [pendingJob, ...previous].slice(0, DERIVED_JOB_HISTORY_LIMIT));
    const updateJob = (patch: Partial<DerivedColumnJob>) => {
      setDerivedColumnJobs((previous) => previous.map((job) => job.id === jobId ? { ...job, ...patch } : job));
    };
    pushStatus(`Performing the reaction for ${targetDocument.title}`);
    void (async () => {
      let runner: ReturnType<typeof createReactionRunner> | null = null;
      try {
        const engines = await loadDerivedEngines();
        runner = createReactionRunner(engines, smarts);
        const columnId = `rxn_${label.replace(/[^A-Za-z0-9_-]+/gu, "_").slice(0, 60)}`;
        let afterSourceIndex = -1;
        let processedRows = 0;
        let failedRows = 0;
        for (;;) {
          const batch = await fetchDerivedSourceRows(documentId, afterSourceIndex, DERIVED_SOURCE_BATCH);
          if (processedRows === 0) updateJob({ totalRows: batch.totalRows });
          if (batch.rows.length === 0) break;
          const values: DerivedStoreValue[] = batch.rows.map((row) => {
            const result = runReactionOnRow(engines, runner!, row, coReactants);
            if (result.errorText) failedRows += 1;
            return {
              rowId: row.rowId,
              valueReal: null,
              valueText: result.valueText ?? null,
              errorText: result.errorText ?? null,
            };
          });
          await storeDerivedValues(documentId, {
            columnId,
            label,
            kind: "reaction-product",
            paramsJson: JSON.stringify({ smarts, coReactants }),
          }, values);
          processedRows += batch.rows.length;
          afterSourceIndex = batch.rows[batch.rows.length - 1].sourceIndex;
          updateJob({ processedRows, failedRows });
          await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
        updateJob({ status: "success", completedAt: Date.now(), processedRows, failedRows });
        notifyGridDerivedRunFinished(documentId);
        const reacted = processedRows - failedRows;
        pushStatus(
          `The reaction gave a product for ${reacted.toLocaleString()} of ${processedRows.toLocaleString()} molecule${processedRows === 1 ? "" : "s"}`,
          reacted === 0 ? "error" : "success",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateJob({ status: "failed", completedAt: Date.now(), error: message });
        pushStatus(`Perform reaction failed: ${message}`, "error");
      } finally {
        try { runner?.delete(); } catch { /* the run is over either way */ }
        runningKeysRef.current.delete(runKey);
      }
    })();
  }, [documents, notifyGridDerivedRunFinished, pushStatus]);

  // Computed columns: evaluates a formula over other columns. Values come from
  // the grid's column channel keyed by row index, then the desktop pass walks
  // the collection to pair those indexes with the database ids the store needs.
  // Merge Columns: DataWarrior joins two columns into a third, and the join is
  // over what the cells display rather than over numbers, so a name column and
  // an id column merge as readily as two measurements. Values are stored as
  // text through the same derived channel every other computed column uses.
  const mergeGridColumns = useCallback((
    documentId: string,
    label: string,
    separator: string,
    columns: Array<{ id: string; label: string }>,
  ) => {
    const targetDocument = documents.find((document) => document.id === documentId);
    if (!targetDocument) {
      pushStatus("Grid target is not open.", "error");
      return;
    }
    if (columns.length < 2) {
      pushStatus("Merging needs two columns.", "error");
      return;
    }
    const runKey = `${documentId}:merge:${label}`;
    if (runningKeysRef.current.has(runKey)) return;
    runningKeysRef.current.add(runKey);
    const jobId = `merge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const pendingJob: DerivedColumnJob = {
      id: jobId,
      columnLabel: label,
      documentTitle: targetDocument.title,
      status: "running",
      startedAt: Date.now(),
      completedAt: null,
      processedRows: 0,
      failedRows: 0,
      totalRows: 0,
      error: null,
    };
    setDerivedColumnJobs((previous) => [pendingJob, ...previous].slice(0, DERIVED_JOB_HISTORY_LIMIT));
    const updateJob = (patch: Partial<DerivedColumnJob>) => {
      setDerivedColumnJobs((previous) => previous.map((job) => job.id === jobId ? { ...job, ...patch } : job));
    };
    pushStatus(`Merging ${columns.map((column) => column.label).join(" + ")} in ${targetDocument.title}`);
    void (async () => {
      try {
        const sources: Array<Map<number, string>> = [];
        for (const column of columns) sources.push(await requestGridColumnText(documentId, column.id));
        // A row missing every part has nothing to merge; one missing part just
        // leaves that side out rather than writing a stray separator.
        const mergedFor = (rowIndex: number) => joinColumnValues(
          sources.map((source) => source.get(rowIndex) ?? ""),
          separator,
        );
        const columnId = `merge_${label.replace(/[^A-Za-z0-9_-]+/gu, "_").slice(0, 60)}`;
        let processedRows = 0;
        let failedRows = 0;
        if (isTauriRuntime()) {
          let afterSourceIndex = -1;
          for (;;) {
            const batch = await fetchDerivedSourceRows(documentId, afterSourceIndex, DERIVED_SOURCE_BATCH);
            if (processedRows === 0) updateJob({ totalRows: batch.totalRows });
            if (batch.rows.length === 0) break;
            const stored: DerivedStoreValue[] = batch.rows.map((row) => {
              const merged = mergedFor(row.sourceIndex);
              if (merged === null) failedRows += 1;
              return { rowId: row.rowId, valueReal: null, valueText: merged, errorText: null };
            });
            await storeDerivedValues(documentId, { columnId, label, kind: "merged" }, stored);
            processedRows += batch.rows.length;
            afterSourceIndex = batch.rows[batch.rows.length - 1].sourceIndex;
            updateJob({ processedRows, failedRows });
            await new Promise((resolve) => window.setTimeout(resolve, 0));
          }
          notifyGridDerivedRunFinished(documentId);
        } else {
          const rowIndexes = [...new Set(sources.flatMap((source) => [...source.keys()]))].sort((a, b) => a - b);
          updateJob({ totalRows: rowIndexes.length });
          const rows = rowIndexes.map((rowIndex) => {
            const merged = mergedFor(rowIndex);
            processedRows += 1;
            if (merged === null) failedRows += 1;
            return {
              index: rowIndex,
              descriptors: {
                [columnId]: { id: columnId, label, value: merged, missingKind: null, errorText: null },
              },
            };
          });
          activeViewerIframeForDocument(documentId, "grid2d")?.contentWindow?.postMessage({
            source: "burette-grid-host",
            body: { type: "gridDescriptorResults", documentId, rows },
          }, "*");
        }
        updateJob({
          status: "success",
          completedAt: Date.now(),
          processedRows,
          failedRows,
        });
        pushStatus(`${label} added to ${targetDocument.title}`, "success");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateJob({ status: "failed", completedAt: Date.now(), error: message });
        pushStatus(`Merge failed: ${message}`, "error");
      } finally {
        runningKeysRef.current.delete(runKey);
      }
    })();
  }, [documents, pushStatus]);

  // Set Value Range: the limits are column metadata inside the grid, not a
  // rewrite of the collection, so this hands them over and the grid applies
  // them under a single undo entry.
  const setGridColumnValueRange = useCallback((
    documentId: string,
    column: { id: string; label: string },
    min: string,
    max: string,
  ) => {
    const iframe = activeViewerIframeForDocument(documentId, "grid2d");
    if (!iframe?.contentWindow) {
      pushStatus("Grid is not open.", "error");
      return;
    }
    iframe.contentWindow.postMessage({
      source: "burette-grid-host",
      body: {
        type: "gridSetValueRange",
        documentId,
        columnId: column.id,
        columnLabel: column.label,
        min,
        max,
      },
    }, "*");
  }, [pushStatus]);

  // Split Multiple Value Rows: the grid holds the cells and the virtual edit
  // layer that can add rows, so it performs the split and keeps it in one undo
  // entry.
  const splitGridValueRows = useCallback((
    documentId: string,
    column: { id: string; label: string },
    delimiter: string,
  ) => {
    const iframe = activeViewerIframeForDocument(documentId, "grid2d");
    if (!iframe?.contentWindow) {
      pushStatus("Grid is not open.", "error");
      return;
    }
    iframe.contentWindow.postMessage({
      source: "burette-grid-host",
      body: {
        type: "gridSplitRows",
        documentId,
        columnId: column.id,
        columnLabel: column.label,
        delimiter,
      },
    }, "*");
  }, [pushStatus]);

  const addCalculatedGridColumn = useCallback((
    documentId: string,
    label: string,
    formula: string,
    columns: Array<{ id: string; label: string }>,
  ) => {
    const targetDocument = documents.find((document) => document.id === documentId);
    if (!targetDocument) {
      pushStatus("Grid target is not open.", "error");
      return;
    }
    let compiled;
    try {
      compiled = compileFormula(formula);
    } catch (error) {
      pushStatus(error instanceof Error ? error.message : String(error), "error");
      return;
    }
    const runKey = `${documentId}:calculated:${label}`;
    if (runningKeysRef.current.has(runKey)) return;
    runningKeysRef.current.add(runKey);
    const jobId = `calculated-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const pendingJob: DerivedColumnJob = {
      id: jobId,
      columnLabel: label,
      documentTitle: targetDocument.title,
      status: "running",
      startedAt: Date.now(),
      completedAt: null,
      processedRows: 0,
      failedRows: 0,
      totalRows: 0,
      error: null,
    };
    setDerivedColumnJobs((previous) => [pendingJob, ...previous].slice(0, DERIVED_JOB_HISTORY_LIMIT));
    const updateJob = (patch: Partial<DerivedColumnJob>) => {
      setDerivedColumnJobs((previous) => previous.map((job) => job.id === jobId ? { ...job, ...patch } : job));
    };
    pushStatus(`Calculating ${label} for ${targetDocument.title}`);
    void (async () => {
      try {
        const byLabel = new Map(columns.map((column) => [column.label.trim().toLowerCase(), column.id]));
        const values = new Map<string, Map<number, number>>();
        for (const name of compiled.variables) {
          const columnId = byLabel.get(name.trim().toLowerCase());
          if (!columnId) throw new Error(`No numeric column named "${name}".`);
          values.set(name, await requestGridColumnValues(documentId, columnId));
        }
        const lookupFor = (rowIndex: number) => (name: string) => values.get(name)?.get(rowIndex) ?? null;
        let processedRows = 0;
        let failedRows = 0;
        const columnId = `calc_${label.replace(/[^A-Za-z0-9_-]+/gu, "_").slice(0, 60)}`;
        if (isTauriRuntime()) {
          let afterSourceIndex = -1;
          for (;;) {
            const batch = await fetchDerivedSourceRows(documentId, afterSourceIndex, DERIVED_SOURCE_BATCH);
            if (processedRows === 0) updateJob({ totalRows: batch.totalRows });
            if (batch.rows.length === 0) break;
            const stored: DerivedStoreValue[] = batch.rows.map((row) => {
              const value = compiled.evaluate(lookupFor(row.sourceIndex));
              if (value === null) failedRows += 1;
              return { rowId: row.rowId, valueReal: value, valueText: null, errorText: null };
            });
            await storeDerivedValues(documentId, { columnId, label, kind: "calculated" }, stored);
            processedRows += batch.rows.length;
            afterSourceIndex = batch.rows[batch.rows.length - 1].sourceIndex;
            updateJob({ processedRows, failedRows });
            await new Promise((resolve) => window.setTimeout(resolve, 0));
          }
          notifyGridDerivedRunFinished(documentId);
        } else {
          const rowIndexes = [...new Set([...values.values()].flatMap((map) => [...map.keys()]))].sort((a, b) => a - b);
          updateJob({ totalRows: rowIndexes.length });
          const rows = rowIndexes.map((rowIndex) => {
            const value = compiled.evaluate(lookupFor(rowIndex));
            processedRows += 1;
            if (value === null) failedRows += 1;
            return {
              index: rowIndex,
              descriptors: {
                [columnId]: { id: columnId, label, value, missingKind: null, errorText: null },
              },
            };
          });
          activeViewerIframeForDocument(documentId, "grid2d")?.contentWindow?.postMessage({
            source: "burette-grid-host",
            body: { type: "gridDescriptorResults", documentId, rows },
          }, "*");
          updateJob({ processedRows, failedRows });
        }
        updateJob({ status: "success", completedAt: Date.now(), processedRows, failedRows });
        pushStatus(
          failedRows > 0
            ? `Calculated ${label} for ${(processedRows - failedRows).toLocaleString()} of ${processedRows.toLocaleString()} rows (${failedRows.toLocaleString()} missing an input)`
            : `Calculated ${label} for ${processedRows.toLocaleString()} row${processedRows === 1 ? "" : "s"}`,
          "success",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateJob({ status: "failed", completedAt: Date.now(), error: message });
        pushStatus(`Calculate ${label} failed: ${message}`, "error");
      } finally {
        runningKeysRef.current.delete(runKey);
      }
    })();
  }, [documents, notifyGridDerivedRunFinished, pushStatus]);

  // The job bookkeeping every run above writes out by hand, named once so the
  // SAR analyses below can say what they compute instead of how they report it.
  const beginDerivedJob = useCallback((columnLabel: string, documentTitle: string) => {
    const jobId = `derived-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const pendingJob: DerivedColumnJob = {
      id: jobId,
      columnLabel,
      documentTitle,
      status: "running",
      startedAt: Date.now(),
      completedAt: null,
      processedRows: 0,
      failedRows: 0,
      totalRows: 0,
      error: null,
    };
    setDerivedColumnJobs((previous) => [pendingJob, ...previous].slice(0, DERIVED_JOB_HISTORY_LIMIT));
    return (patch: Partial<DerivedColumnJob>) => {
      setDerivedColumnJobs((previous) => previous.map((job) => job.id === jobId ? { ...job, ...patch } : job));
    };
  }, []);

  // Analyse Scaffolds: the Bemis-Murcko core of every molecule, and how many
  // molecules share it. The count needs the whole collection before it can be
  // written, so the scaffolds stream out as they are computed and the counts
  // follow in a second pass over the ids already collected.
  const addScaffoldGridColumns = useCallback((documentId: string) => {
    const targetDocument = documents.find((document) => document.id === documentId);
    if (!targetDocument) {
      pushStatus("Grid target is not open.", "error");
      return;
    }
    const runKey = `${documentId}:scaffolds`;
    if (runningKeysRef.current.has(runKey)) return;
    runningKeysRef.current.add(runKey);
    const scaffoldColumn = DERIVED_COLUMN_KINDS["murcko-scaffold"];
    const updateJob = beginDerivedJob(scaffoldColumn.label, targetDocument.title);
    pushStatus(`Analysing scaffolds in ${targetDocument.title}`);
    void (async () => {
      try {
        const engines = await loadDerivedEngines();
        const counts = new Map<string, number>();
        const scaffolds: Array<{ rowId: number; scaffold: string | null; errorText: string | null }> = [];
        let processedRows = 0;
        let failedRows = 0;
        const consider = (rowId: number, row: DerivedComputeRow) => {
          const result = computeDerivedValue("murcko-scaffold", engines, row);
          processedRows += 1;
          if (result.errorText) failedRows += 1;
          const scaffold = result.errorText ? null : result.valueText ?? "";
          if (scaffold) counts.set(scaffold, (counts.get(scaffold) ?? 0) + 1);
          scaffolds.push({ rowId, scaffold, errorText: result.errorText ?? null });
          return scaffolds[scaffolds.length - 1];
        };
        if (isTauriRuntime()) {
          let afterSourceIndex = -1;
          for (;;) {
            const batch = await fetchDerivedSourceRows(documentId, afterSourceIndex, DERIVED_SOURCE_BATCH);
            if (processedRows === 0) updateJob({ totalRows: batch.totalRows });
            if (batch.rows.length === 0) break;
            const values: DerivedStoreValue[] = batch.rows.map((row) => {
              const computed = consider(row.rowId, row);
              return {
                rowId: row.rowId,
                valueReal: null,
                valueText: computed.scaffold,
                errorText: computed.errorText,
              };
            });
            await storeDerivedValues(documentId, {
              columnId: scaffoldColumn.columnId,
              label: scaffoldColumn.label,
              kind: "murcko-scaffold",
            }, values);
            afterSourceIndex = batch.rows[batch.rows.length - 1].sourceIndex;
            updateJob({ processedRows, failedRows });
            await new Promise((resolve) => window.setTimeout(resolve, 0));
          }
          for (let start = 0; start < scaffolds.length; start += DERIVED_STORE_BATCH) {
            await storeDerivedValues(documentId, {
              columnId: SCAFFOLD_COUNT_COLUMN.columnId,
              label: SCAFFOLD_COUNT_COLUMN.label,
              kind: "scaffold-count",
            }, scaffolds.slice(start, start + DERIVED_STORE_BATCH).map((entry) => ({
              rowId: entry.rowId,
              valueReal: entry.scaffold ? counts.get(entry.scaffold) ?? 0 : null,
              valueText: null,
              errorText: entry.errorText,
            })));
          }
          notifyGridDerivedRunFinished(documentId);
        } else {
          const records = await requestGridRecords(documentId);
          updateJob({ totalRows: records.length });
          for (const record of records) consider(record.index, record);
          activeViewerIframeForDocument(documentId, "grid2d")?.contentWindow?.postMessage({
            source: "burette-grid-host",
            body: {
              type: "gridDescriptorResults",
              documentId,
              rows: scaffolds.map((entry) => ({
                index: entry.rowId,
                descriptors: {
                  [scaffoldColumn.columnId]: {
                    id: scaffoldColumn.columnId,
                    label: scaffoldColumn.label,
                    value: entry.scaffold,
                    missingKind: entry.errorText ? "error" : null,
                    errorText: entry.errorText,
                  },
                  [SCAFFOLD_COUNT_COLUMN.columnId]: {
                    id: SCAFFOLD_COUNT_COLUMN.columnId,
                    label: SCAFFOLD_COUNT_COLUMN.label,
                    value: entry.scaffold ? counts.get(entry.scaffold) ?? 0 : null,
                    missingKind: entry.errorText ? "error" : null,
                    errorText: entry.errorText,
                  },
                },
              })),
            },
          }, "*");
        }
        updateJob({ status: "success", completedAt: Date.now(), processedRows, failedRows });
        const distinct = counts.size;
        pushStatus(
          `Found ${distinct.toLocaleString()} scaffold${distinct === 1 ? "" : "s"} across ${processedRows.toLocaleString()} molecule${processedRows === 1 ? "" : "s"}${failedRows > 0 ? ` (${failedRows.toLocaleString()} could not be read)` : ""}`,
          distinct === 0 ? "error" : "success",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateJob({ status: "failed", completedAt: Date.now(), error: message });
        pushStatus(`Analyse scaffolds failed: ${message}`, "error");
      } finally {
        runningKeysRef.current.delete(runKey);
      }
    })();
  }, [beginDerivedJob, documents, notifyGridDerivedRunFinished, pushStatus]);

  // Substructure Count: how often a SMARTS query occurs in each molecule. The
  // query is compiled once before the job starts, so a typo is a message next
  // to the field rather than an error on every row.
  const addSubstructureCountColumn = useCallback((documentId: string, label: string, smarts: string) => {
    const targetDocument = documents.find((document) => document.id === documentId);
    if (!targetDocument) {
      pushStatus("Grid target is not open.", "error");
      return;
    }
    const columnLabel = label.trim() || "Substructure Count";
    const runKey = `${documentId}:substructure:${columnLabel}`;
    if (runningKeysRef.current.has(runKey)) return;
    runningKeysRef.current.add(runKey);
    const columnId = `sub_${columnLabel.replace(/[^A-Za-z0-9_-]+/gu, "_").slice(0, 60)}`;
    const updateJob = beginDerivedJob(columnLabel, targetDocument.title);
    pushStatus(`Counting ${smarts} in ${targetDocument.title}`);
    void (async () => {
      try {
        const engines = await loadDerivedEngines();
        const searcher = compileSubstructureQuery(engines.ocl, smarts);
        let processedRows = 0;
        let failedRows = 0;
        let matchedRows = 0;
        const countRow = (row: DerivedComputeRow) => {
          const result = countSubstructureMatches(engines, searcher, row);
          processedRows += 1;
          if (result.errorText) failedRows += 1;
          else if ((result.valueReal ?? 0) > 0) matchedRows += 1;
          return result;
        };
        if (isTauriRuntime()) {
          let afterSourceIndex = -1;
          for (;;) {
            const batch = await fetchDerivedSourceRows(documentId, afterSourceIndex, DERIVED_SOURCE_BATCH);
            if (processedRows === 0) updateJob({ totalRows: batch.totalRows });
            if (batch.rows.length === 0) break;
            await storeDerivedValues(documentId, {
              columnId,
              label: columnLabel,
              kind: "substructure-count",
              paramsJson: JSON.stringify({ smarts }),
            }, batch.rows.map((row) => {
              const result = countRow(row);
              return {
                rowId: row.rowId,
                valueReal: result.valueReal ?? null,
                valueText: null,
                errorText: result.errorText ?? null,
              };
            }));
            afterSourceIndex = batch.rows[batch.rows.length - 1].sourceIndex;
            updateJob({ processedRows, failedRows });
            await new Promise((resolve) => window.setTimeout(resolve, 0));
          }
          notifyGridDerivedRunFinished(documentId);
        } else {
          const records = await requestGridRecords(documentId);
          updateJob({ totalRows: records.length });
          const rows = records.map((record) => {
            const result = countRow(record);
            return {
              index: record.index,
              descriptors: {
                [columnId]: {
                  id: columnId,
                  label: columnLabel,
                  value: result.valueReal ?? null,
                  missingKind: result.errorText ? "error" : null,
                  errorText: result.errorText ?? null,
                },
              },
            };
          });
          activeViewerIframeForDocument(documentId, "grid2d")?.contentWindow?.postMessage({
            source: "burette-grid-host",
            body: { type: "gridDescriptorResults", documentId, rows },
          }, "*");
        }
        updateJob({ status: "success", completedAt: Date.now(), processedRows, failedRows });
        pushStatus(
          `${matchedRows.toLocaleString()} of ${processedRows.toLocaleString()} molecule${processedRows === 1 ? "" : "s"} contain ${smarts}${failedRows > 0 ? ` (${failedRows.toLocaleString()} could not be read)` : ""}`,
          "success",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateJob({ status: "failed", completedAt: Date.now(), error: message });
        pushStatus(`Substructure count failed: ${message}`, "error");
      } finally {
        runningKeysRef.current.delete(runKey);
      }
    })();
  }, [beginDerivedJob, documents, notifyGridDerivedRunFinished, pushStatus]);

  // Find Similar In File: fingerprints a second file and gives every row of the
  // open collection its best match there - the similarity and which molecule it
  // was. The fingerprint is the same Morgan the cluster and chemical-space
  // pipelines use, so a number here means what a number there means.
  const addSimilarityToFileColumns = useCallback((documentId: string, referencePath: string) => {
    const targetDocument = documents.find((document) => document.id === documentId);
    if (!targetDocument) {
      pushStatus("Grid target is not open.", "error");
      return;
    }
    const runKey = `${documentId}:similar-in-file`;
    if (runningKeysRef.current.has(runKey)) return;
    runningKeysRef.current.add(runKey);
    const referenceName = referencePath.split("/").filter(Boolean).pop() || referencePath;
    const similarityColumn = { columnId: "SimilarityToFile", label: `Similarity to ${referenceName}`.slice(0, 120) };
    const matchColumn = { columnId: "MostSimilarInFile", label: `Most similar in ${referenceName}`.slice(0, 120) };
    const updateJob = beginDerivedJob(similarityColumn.label, targetDocument.title);
    pushStatus(`Reading ${referenceName}`);
    void (async () => {
      try {
        const engines = await loadDerivedEngines();
        const text = await readStructureText(referencePath, { maxBytes: REFERENCE_FILE_MAX_BYTES });
        const extension = referenceName.includes(".") ? referenceName.split(".").pop() ?? "" : "";
        const structures = parseReferenceStructures(text, extension);
        if (structures.length === 0) throw new Error(`${referenceName} has no molecules to compare against.`);
        if (structures.length > REFERENCE_STRUCTURE_LIMIT) {
          throw new Error(`${referenceName} holds ${structures.length.toLocaleString()} molecules; the limit is ${REFERENCE_STRUCTURE_LIMIT.toLocaleString()}.`);
        }
        const reference: ReferenceFingerprint[] = [];
        for (const structure of structures) {
          try {
            reference.push({
              name: structure.name,
              fingerprint: morganFingerprint(engines.rdkit, structure.molblock ?? structure.smiles ?? ""),
            });
          } catch {
            // A reference molecule that will not fingerprint is left out; the
            // remaining ones still answer the question.
          }
        }
        if (reference.length === 0) throw new Error(`No molecule in ${referenceName} could be fingerprinted.`);
        pushStatus(`Comparing ${targetDocument.title} against ${reference.length.toLocaleString()} molecules from ${referenceName}`);
        let processedRows = 0;
        let failedRows = 0;
        let best = 0;
        const matchRow = (row: DerivedComputeRow) => {
          const result = closestReferenceMatch(engines, row, reference);
          processedRows += 1;
          if (result.errorText) failedRows += 1;
          else best = Math.max(best, result.similarity ?? 0);
          return result;
        };
        if (isTauriRuntime()) {
          let afterSourceIndex = -1;
          for (;;) {
            const batch = await fetchDerivedSourceRows(documentId, afterSourceIndex, DERIVED_SOURCE_BATCH);
            if (processedRows === 0) updateJob({ totalRows: batch.totalRows });
            if (batch.rows.length === 0) break;
            const results = batch.rows.map((row) => matchRow(row));
            await storeDerivedValues(documentId, { ...similarityColumn, kind: "similarity", paramsJson: JSON.stringify({ referencePath }) },
              batch.rows.map((row, index) => ({
                rowId: row.rowId,
                valueReal: results[index].similarity ?? null,
                valueText: null,
                errorText: results[index].errorText ?? null,
              })));
            await storeDerivedValues(documentId, { ...matchColumn, kind: "similarity", paramsJson: JSON.stringify({ referencePath }) },
              batch.rows.map((row, index) => ({
                rowId: row.rowId,
                valueReal: null,
                valueText: results[index].name ?? null,
                errorText: results[index].errorText ?? null,
              })));
            afterSourceIndex = batch.rows[batch.rows.length - 1].sourceIndex;
            updateJob({ processedRows, failedRows });
            await new Promise((resolve) => window.setTimeout(resolve, 0));
          }
          notifyGridDerivedRunFinished(documentId);
        } else {
          const records = await requestGridRecords(documentId);
          updateJob({ totalRows: records.length });
          const rows = records.map((record) => {
            const result = matchRow(record);
            return {
              index: record.index,
              descriptors: {
                [similarityColumn.columnId]: {
                  id: similarityColumn.columnId,
                  label: similarityColumn.label,
                  value: result.similarity ?? null,
                  missingKind: result.errorText ? "error" : null,
                  errorText: result.errorText ?? null,
                },
                [matchColumn.columnId]: {
                  id: matchColumn.columnId,
                  label: matchColumn.label,
                  value: result.name ?? null,
                  missingKind: result.errorText ? "error" : null,
                  errorText: result.errorText ?? null,
                },
              },
            };
          });
          activeViewerIframeForDocument(documentId, "grid2d")?.contentWindow?.postMessage({
            source: "burette-grid-host",
            body: { type: "gridDescriptorResults", documentId, rows },
          }, "*");
        }
        updateJob({ status: "success", completedAt: Date.now(), processedRows, failedRows });
        pushStatus(
          `Compared ${processedRows.toLocaleString()} molecule${processedRows === 1 ? "" : "s"} against ${referenceName}; best match ${best.toFixed(3)}`,
          "success",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateJob({ status: "failed", completedAt: Date.now(), error: message });
        pushStatus(`Find similar in file failed: ${message}`, "error");
      } finally {
        runningKeysRef.current.delete(runKey);
      }
    })();
  }, [beginDerivedJob, documents, notifyGridDerivedRunFinished, pushStatus]);

  // Decompose R-Groups: the core plus one column per substitution point. The
  // core comes from the dialog, or - when the dialog left it blank - from the
  // scaffold the collection has most of, computed with the same Murcko code
  // Analyse Scaffolds uses.
  const decomposeGridRGroups = useCallback((documentId: string, requestedCore: string) => {
    const targetDocument = documents.find((document) => document.id === documentId);
    if (!targetDocument) {
      pushStatus("Grid target is not open.", "error");
      return;
    }
    if (!isTauriRuntime()) {
      pushStatus("R-group decomposition runs in the desktop app; it needs the Python RDKit runtime.", "error");
      return;
    }
    const runKey = `${documentId}:rgroups`;
    if (runningKeysRef.current.has(runKey)) return;
    runningKeysRef.current.add(runKey);
    const updateJob = beginDerivedJob("R-Groups", targetDocument.title);
    pushStatus(`Decomposing R-groups in ${targetDocument.title}`);
    void (async () => {
      try {
        const engines = await loadDerivedEngines();
        const rows: Array<{ rowId: number; smiles: string | null; molblock: string | null }> = [];
        const scaffoldCounts = new Map<string, number>();
        let afterSourceIndex = -1;
        for (;;) {
          const batch = await fetchDerivedSourceRows(documentId, afterSourceIndex, DERIVED_SOURCE_BATCH);
          if (rows.length === 0) updateJob({ totalRows: batch.totalRows });
          if (batch.rows.length === 0) break;
          for (const row of batch.rows) {
            rows.push({ rowId: row.rowId, smiles: row.smiles ?? null, molblock: row.molblock ?? null });
            if (!requestedCore.trim()) {
              const scaffold = computeDerivedValue("murcko-scaffold", engines, row).valueText;
              if (scaffold) scaffoldCounts.set(scaffold, (scaffoldCounts.get(scaffold) ?? 0) + 1);
            }
          }
          if (rows.length > RGROUP_ROW_LIMIT) {
            throw new Error(`R-group decomposition is limited to ${RGROUP_ROW_LIMIT.toLocaleString()} molecules.`);
          }
          afterSourceIndex = batch.rows[batch.rows.length - 1].sourceIndex;
          updateJob({ processedRows: rows.length });
          await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
        if (rows.length === 0) throw new Error("The collection has no molecules.");
        let core = requestedCore.trim();
        if (!core) {
          const ranked = [...scaffoldCounts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
          if (ranked.length === 0) throw new Error("No molecule has a ring system to use as a core.");
          core = ranked[0][0];
          pushStatus(`Using the collection's most common scaffold as the core: ${core}`);
        }
        const decomposition = await decomposeRGroupsInRuntime(core, rows);
        if (decomposition.rows.length === 0) {
          throw new Error(`No molecule matched the core ${core}.`);
        }
        const byRow = new Map(decomposition.rows.map((row) => [row.rowId, row.values]));
        for (const label of decomposition.labels) {
          const columnId = `RGroup_${label}`;
          const values: DerivedStoreValue[] = rows
            .filter((row) => byRow.has(row.rowId))
            .map((row) => ({
              rowId: row.rowId,
              valueReal: null,
              valueText: byRow.get(row.rowId)?.[label] ?? "",
              errorText: null,
            }));
          for (let start = 0; start < values.length; start += DERIVED_STORE_BATCH) {
            await storeDerivedValues(documentId, {
              columnId,
              label: label === "Core" ? "R-Group Core" : label,
              kind: "rgroup",
              paramsJson: JSON.stringify({ core, label }),
            }, values.slice(start, start + DERIVED_STORE_BATCH));
          }
        }
        notifyGridDerivedRunFinished(documentId);
        const skipped = decomposition.unmatchedRows + decomposition.unparsedRows;
        updateJob({
          status: "success",
          completedAt: Date.now(),
          processedRows: rows.length,
          failedRows: skipped,
        });
        const positions = decomposition.labels.filter((label) => label !== "Core").length;
        pushStatus(
          `Decomposed ${decomposition.rows.length.toLocaleString()} molecule${decomposition.rows.length === 1 ? "" : "s"} into ${positions} R position${positions === 1 ? "" : "s"}${skipped > 0 ? ` (${skipped.toLocaleString()} did not match the core)` : ""}`,
          "success",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateJob({ status: "failed", completedAt: Date.now(), error: message });
        pushStatus(`Decompose R-groups failed: ${message}`, "error");
      } finally {
        runningKeysRef.current.delete(runKey);
      }
    })();
  }, [beginDerivedJob, documents, notifyGridDerivedRunFinished, pushStatus]);

  // Deduplication: pages the whole collection through the same channel the
  // derived columns use, keys every molecule by its InChI-Key, and hands the
  // grid the later copies to drop. Doing it here rather than in the grid is
  // what makes it work on a paged collection, where the grid only ever holds
  // one page.
  const deleteDuplicateGridRows = useCallback((documentId: string) => {
    const targetDocument = documents.find((document) => document.id === documentId);
    if (!targetDocument) {
      pushStatus("Grid target is not open.", "error");
      return;
    }
    const runKey = `${documentId}:duplicates`;
    if (runningKeysRef.current.has(runKey)) return;
    runningKeysRef.current.add(runKey);
    const jobId = `duplicates-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const pendingJob: DerivedColumnJob = {
      id: jobId,
      columnLabel: "Find duplicates",
      documentTitle: targetDocument.title,
      status: "running",
      startedAt: Date.now(),
      completedAt: null,
      processedRows: 0,
      failedRows: 0,
      totalRows: 0,
      error: null,
    };
    setDerivedColumnJobs((previous) => [pendingJob, ...previous].slice(0, DERIVED_JOB_HISTORY_LIMIT));
    const updateJob = (patch: Partial<DerivedColumnJob>) => {
      setDerivedColumnJobs((previous) => previous.map((job) => job.id === jobId ? { ...job, ...patch } : job));
    };
    pushStatus(`Looking for duplicate molecules in ${targetDocument.title}`);
    void (async () => {
      try {
        const identity = await collectStructureIdentityGroups(documentId, updateJob);
        const { processedRows, failedRows } = identity;
        const duplicates = identity.groups.flatMap((group) => group.mergeIndexes);
        updateJob({ status: "success", completedAt: Date.now(), processedRows, failedRows });
        if (duplicates.length === 0) {
          pushStatus(`No duplicate molecules in ${processedRows.toLocaleString()} rows`, "success");
          return;
        }
        activeViewerIframeForDocument(documentId, "grid2d")?.contentWindow?.postMessage({
          source: "burette-grid-host",
          body: { type: "gridHideRows", documentId, rowIndexes: duplicates, label: "Delete Duplicate Molecules" },
        }, "*");
        pushStatus(
          `Removed ${duplicates.length.toLocaleString()} duplicate molecule${duplicates.length === 1 ? "" : "s"} of ${processedRows.toLocaleString()}`,
          "success",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateJob({ status: "failed", completedAt: Date.now(), error: message });
        pushStatus(`Duplicate search failed: ${message}`, "error");
      } finally {
        runningKeysRef.current.delete(runKey);
      }
    })();
  }, [documents, pushStatus]);

  // Merge Equivalent Rows: the same identity Delete Duplicate Molecules uses,
  // but the equivalent rows are folded into the row that stays instead of being
  // dropped. The grid holds the cells, so it performs the join and keeps the
  // whole merge in one undo entry.
  const mergeEquivalentGridRows = useCallback((documentId: string) => {
    const targetDocument = documents.find((document) => document.id === documentId);
    if (!targetDocument) {
      pushStatus("Grid target is not open.", "error");
      return;
    }
    const runKey = `${documentId}:merge-rows`;
    if (runningKeysRef.current.has(runKey)) return;
    runningKeysRef.current.add(runKey);
    const jobId = `merge-rows-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const pendingJob: DerivedColumnJob = {
      id: jobId,
      columnLabel: "Merge equivalent rows",
      documentTitle: targetDocument.title,
      status: "running",
      startedAt: Date.now(),
      completedAt: null,
      processedRows: 0,
      failedRows: 0,
      totalRows: 0,
      error: null,
    };
    setDerivedColumnJobs((previous) => [pendingJob, ...previous].slice(0, DERIVED_JOB_HISTORY_LIMIT));
    const updateJob = (patch: Partial<DerivedColumnJob>) => {
      setDerivedColumnJobs((previous) => previous.map((job) => job.id === jobId ? { ...job, ...patch } : job));
    };
    pushStatus(`Looking for equivalent molecules in ${targetDocument.title}`);
    void (async () => {
      try {
        const { groups, processedRows, failedRows } = await collectStructureIdentityGroups(documentId, updateJob);
        updateJob({ status: "success", completedAt: Date.now(), processedRows, failedRows });
        const mergedRows = groups.reduce((count, group) => count + group.mergeIndexes.length, 0);
        if (mergedRows === 0) {
          pushStatus(`Every molecule in ${processedRows.toLocaleString()} rows is unique`, "success");
          return;
        }
        activeViewerIframeForDocument(documentId, "grid2d")?.contentWindow?.postMessage({
          source: "burette-grid-host",
          body: { type: "gridMergeRows", documentId, groups, separator: MERGED_VALUE_SEPARATOR },
        }, "*");
        pushStatus(
          `Merged ${(mergedRows + groups.length).toLocaleString()} rows into ${groups.length.toLocaleString()} molecule${groups.length === 1 ? "" : "s"}`,
          "success",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateJob({ status: "failed", completedAt: Date.now(), error: message });
        pushStatus(`Merging equivalent rows failed: ${message}`, "error");
      } finally {
        runningKeysRef.current.delete(runKey);
      }
    })();
  }, [documents, pushStatus]);

  // Find Similar In File has nothing to configure beyond the file itself, so
  // the picker stands in for a dialog.
  const findSimilarInFile = useCallback(async (documentId: string) => {
    if (!documents.some((document) => document.id === documentId)) return;
    const picked = await openFileDialog({
      multiple: false,
      title: "Find similar molecules in file",
      filters: [{ name: "Molecule files", extensions: ["sdf", "sd", "smi", "smiles", "csv", "tsv", "txt"] }],
    });
    if (typeof picked !== "string" || !picked) return;
    addSimilarityToFileColumns(documentId, picked);
  }, [addSimilarityToFileColumns, documents]);

  // The dialog's live check: the engines decide whether a query is a query, so
  // the same compile the run performs is what validates the field.
  const validateSubstructureQuery = useCallback(async (smarts: string) => {
    try {
      const engines = await loadDerivedEngines();
      compileSubstructureQuery(engines.ocl, smarts);
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // openchemlib prefixes its parser errors with the minified class name it
      // was compiled to; the position and the reason are the useful part.
      return message.replace(/^Class\$\w+:\s*/u, "");
    }
  }, []);

  return {
    addCalculatedGridColumn,
    mergeGridColumns,
    setGridColumnValueRange,
    splitGridValueRows,
    addDerivedGridColumn,
    addPropertyGridColumns,
    addReactionProductColumn,
    addScaffoldGridColumns,
    addSubstructureCountColumn,
    decomposeGridRGroups,
    deleteDuplicateGridRows,
    mergeEquivalentGridRows,
    findSimilarInFile,
    validateSubstructureQuery,
    clearDerivedColumnJobs,
    derivedColumnJobs,
    rgroupRuntimeAvailable,
  };
}
