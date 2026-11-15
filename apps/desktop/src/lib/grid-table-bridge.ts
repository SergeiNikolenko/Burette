import { activeViewerIframeForDocument } from "./viewer-bridge";

// Pivot, Unpivot and Merge File by Key read the collection's cells out of the
// grid, work the new table out with lib/table-shaping, and hand the grid the
// row edits to apply under one undo entry. A paged collection is walked page by
// page for both steps, so the wait is long enough for a large file.
const GRID_TABLE_TIMEOUT_MS = 180_000;

type GridReply = Record<string, unknown>;

function requestGrid(documentId: string, body: Record<string, unknown>, replyType: string): Promise<GridReply> {
  return new Promise((resolve, reject) => {
    const iframe = activeViewerIframeForDocument(documentId, "grid2d");
    if (!iframe?.contentWindow) {
      reject(new Error("The collection is not open."));
      return;
    }
    const requestId = `grid-table-${crypto.randomUUID()}`;
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("The collection did not answer."));
    }, GRID_TABLE_TIMEOUT_MS);
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { source?: unknown; body?: GridReply } | null;
      if (data?.source !== "burette-grid" || data.body?.type !== replyType || data.body.requestId !== requestId) return;
      cleanup();
      if (typeof data.body.error === "string" && data.body.error) reject(new Error(data.body.error));
      else resolve(data.body);
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
    };
    window.addEventListener("message", onMessage);
    iframe.contentWindow.postMessage({ source: "burette-grid-host", body: { ...body, requestId, documentId } }, "*");
  });
}

export type GridTable = {
  /** The grid's edit revision the cells were read at; an edit is only applied to that revision. */
  sourceRevision: number;
  /** Every row of the collection, edits included: its source index and one cell per asked column. */
  rows: Array<{ index: number; cells: string[] }>;
};

export async function requestGridTable(documentId: string, columnIds: readonly string[]): Promise<GridTable> {
  const reply = await requestGrid(documentId, { type: "gridRequestTable", columnIds }, "gridTable");
  const rows = Array.isArray(reply.rows) ? reply.rows : [];
  return {
    sourceRevision: Number(reply.sourceRevision),
    rows: rows.flatMap((value) => {
      if (!Array.isArray(value)) return [];
      const index = Number(value[0]);
      if (!Number.isSafeInteger(index) || index < 0) return [];
      return [{ index, cells: columnIds.map((_, position) => String(value[position + 1] ?? "")) }];
    }),
  };
}

/** Cell changes for one row: `set` writes cells (an empty text clears one), `remove` drops them. */
export type GridRowCells = { set?: Record<string, string>; remove?: string[] };

export type GridRowEdits = {
  /** The undo entry's name. */
  label: string;
  /** What the status line says once the edit is in. */
  summary: string;
  sourceRevision: number;
  patches?: Array<GridRowCells & { index: number }>;
  /** Copies of an existing row, structure included, placed after it with their own cell changes. */
  inserts?: Array<GridRowCells & { afterIndex: number }>;
  hide?: number[];
};

export async function applyGridRowEdits(documentId: string, edits: GridRowEdits) {
  const reply = await requestGrid(documentId, { type: "gridApplyRowEdits", ...edits }, "gridRowEditsApplied");
  return {
    patched: Number(reply.patched) || 0,
    inserted: Number(reply.inserted) || 0,
    hidden: Number(reply.hidden) || 0,
  };
}

/** The source indexes of the rows selected in the grid, in ascending order. */
export async function requestGridSelection(documentId: string): Promise<number[]> {
  const reply = await requestGrid(documentId, { type: "gridRequestSelection" }, "gridSelection");
  return (Array.isArray(reply.indexes) ? reply.indexes : [])
    .map(Number)
    .filter((index) => Number.isSafeInteger(index) && index >= 0);
}

/**
 * What the grid does with the rows of a row list: select them, show nothing
 * else (`filter`, or clear that with a null list), or select and export them.
 */
export function postGridRowListCommand(
  documentId: string,
  action: "select" | "filter" | "export-csv" | "export-smiles",
  list: { id: string; name: string; indexes: number[] } | null,
) {
  activeViewerIframeForDocument(documentId, "grid2d")?.contentWindow?.postMessage({
    source: "burette-grid-host",
    body: { type: "gridRowListCommand", documentId, action, ...(list ?? { id: null, indexes: [] }) },
  }, "*");
}
