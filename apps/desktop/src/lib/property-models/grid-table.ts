import { fetchDerivedSourceRows, storeDerivedValues, type DerivedStoreValue } from "../derived-columns";
import { isTauriRuntime } from "../tauri";
import { activeViewerIframeForDocument } from "../viewer-bridge";
import type { ModelTask } from "./build";
import type { ModelSourceRow } from "./model-input";

// A paged desktop collection is read page by page before the grid answers.
const GRID_REPLY_TIMEOUT_MS = 120_000;
const STORE_BATCH = 200;

function askGrid(documentId: string, body: Record<string, unknown>, replyType: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const frame = activeViewerIframeForDocument(documentId, "grid2d");
    if (!frame?.contentWindow) {
      reject(new Error("The collection is not open."));
      return;
    }
    const requestId = `model-${crypto.randomUUID()}`;
    const cleanup = () => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("The collection did not answer."));
    }, GRID_REPLY_TIMEOUT_MS);
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { source?: unknown; body?: Record<string, unknown> } | null;
      if (data?.source !== "burette-grid" || data.body?.type !== replyType || data.body.requestId !== requestId) return;
      cleanup();
      resolve(data.body);
    };
    window.addEventListener("message", onMessage);
    frame.contentWindow.postMessage({ source: "burette-grid-host", body: { ...body, requestId, documentId } }, "*");
  });
}

export type ModelTable = {
  rows: ModelSourceRow[];
  /** Rows whose target cell holds text where a number is expected; they are neither trained on nor filled. */
  unreadableRows: number;
  /** The collection is larger than one table read may return. */
  truncated: boolean;
};

/** Reads the whole collection for a model: the target column, the numeric descriptor columns and, on request, the structures. */
export async function readModelTable(
  documentId: string,
  task: ModelTask,
  targetColumnId: string,
  descriptorColumnIds: string[],
  includeStructures: boolean,
): Promise<ModelTable> {
  const reply = await askGrid(documentId, {
    type: "gridRequestTableRows",
    textColumnIds: [targetColumnId],
    numberColumnIds: descriptorColumnIds,
    includeStructures,
  }, "gridTableRows");
  if (!Array.isArray(reply.rows)) throw new Error("The collection could not be read.");
  const rows: ModelSourceRow[] = [];
  let unreadableRows = 0;
  for (const value of reply.rows) {
    const row = value as { index?: unknown; name?: unknown; smiles?: unknown; molblock?: unknown; text?: unknown; numbers?: unknown };
    if (!Number.isSafeInteger(row.index) || !Array.isArray(row.text) || !Array.isArray(row.numbers)) continue;
    const cell = String(row.text[0] ?? "").trim();
    let target: string | number | null = cell || null;
    if (task === "regression" && cell) {
      target = Number(cell);
      if (!Number.isFinite(target)) { unreadableRows += 1; continue; }
    }
    rows.push({
      index: row.index as number,
      name: typeof row.name === "string" ? row.name : "",
      smiles: typeof row.smiles === "string" ? row.smiles : null,
      molblock: typeof row.molblock === "string" ? row.molblock : null,
      target,
      values: row.numbers.map((entry) => typeof entry === "number" && Number.isFinite(entry) ? entry : null),
    });
  }
  return { rows, unreadableRows, truncated: reply.truncated === true };
}

/**
 * Adds a column of predictions, keyed by grid row index. The desktop keeps it
 * in the collection database like every computed column; the browser grid
 * holds it in memory.
 */
export async function addPredictionColumn(documentId: string, label: string, values: Map<number, number | string>) {
  const columnId = `model_${label.replace(/[^A-Za-z0-9_-]+/gu, "_").slice(0, 60)}`;
  const grid = activeViewerIframeForDocument(documentId, "grid2d")?.contentWindow;
  if (!grid) throw new Error("The collection is not open.");
  if (!isTauriRuntime()) {
    grid.postMessage({
      source: "burette-grid-host",
      body: {
        type: "gridDescriptorResults",
        documentId,
        rows: [...values].map(([index, value]) => ({
          index,
          descriptors: { [columnId]: { id: columnId, label, value, missingKind: null, errorText: null } },
        })),
      },
    }, "*");
    return;
  }
  let afterSourceIndex = -1;
  for (;;) {
    const batch = await fetchDerivedSourceRows(documentId, afterSourceIndex, STORE_BATCH);
    if (batch.rows.length === 0) break;
    const stored: DerivedStoreValue[] = batch.rows.map((row) => {
      const value = values.get(row.sourceIndex);
      return {
        rowId: row.rowId,
        valueReal: typeof value === "number" ? value : null,
        valueText: typeof value === "string" ? value : null,
        errorText: null,
      };
    });
    await storeDerivedValues(documentId, { columnId, label, kind: "prediction" }, stored);
    afterSourceIndex = batch.rows[batch.rows.length - 1].sourceIndex;
  }
  // Stored values reach the desktop grid when it reads its pages again.
  grid.postMessage({ source: "burette-grid-host", body: { type: "gridDescriptorFinished", documentId, descriptorIdCount: 1 } }, "*");
}

/**
 * Writes values into the cells of a file column that are still empty, as one
 * undoable grid edit. Resolves with the number of cells filled, or null when
 * the collection cannot be edited.
 */
export async function fillEmptyCells(
  documentId: string,
  column: { id: string; label: string },
  values: Array<[number, string]>,
): Promise<number | null> {
  const reply = await askGrid(documentId, {
    type: "gridFillEmptyCells",
    columnId: column.id,
    columnLabel: column.label,
    values,
  }, "gridCellsFilled");
  return reply.refused === true ? null : Number(reply.filled) || 0;
}
