import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { activeViewerIframeForDocument, isKnownViewerMessageSource } from "../lib/viewer-bridge";
import {
  COLLECTION_CHART_ROW_LIMIT,
  chartSeriesKey,
  chartTableFromBridge,
  type ChartColumn,
  type ChartColumnRequest,
  type ChartTable,
} from "../lib/collection-chart-data";

// The Chart tab talks to the collection grid over the same postMessage bridge
// as Chemical Space: `burette-grid-host` to the grid, `burette-grid` back.

const COLUMNS_TIMEOUT_MS = 12_000;
// A paged collection answers after walking every page of up to 100k rows.
const DATA_TIMEOUT_MS = 180_000;
const MAX_PREVIEW_BASE64_BYTES = 512 * 1024;

type GridBody = Record<string, unknown>;

export type ChartMoleculePreview = { sourceRecordId: number; name: string; smiles: string; svgUrl: string | null };

function postToGrid(documentId: string, body: GridBody) {
  activeViewerIframeForDocument(documentId, "grid2d")?.contentWindow?.postMessage({
    source: "burette-grid-host",
    body: { ...body, documentId },
  }, "*");
}

/** The body of a message from this document's grid, or null for anything else. */
function gridMessage(event: MessageEvent, documentId: string): GridBody | null {
  const data = event.data && typeof event.data === "object"
    ? event.data as { source?: unknown; body?: GridBody }
    : null;
  if (data?.source !== "burette-grid" || !data.body || data.body.documentId !== documentId
    || !isKnownViewerMessageSource(event.source, documentId)) return null;
  return data.body;
}

// Posts once and again whenever the grid reports ready, so a request made while
// the frame is still loading is not lost and a heavy one is never sent twice to
// a grid that already heard it.
function requestFromGrid<T>(
  documentId: string,
  request: GridBody,
  /** Reads the answer that carries this request's id; null for a malformed one. */
  parse: (body: GridBody) => T | null,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const finish = (settle: () => void) => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      signal.removeEventListener("abort", onAbort);
      settle();
    };
    const onAbort = () => finish(() => reject(new DOMException("Chart request cancelled.", "AbortError")));
    const onMessage = (event: MessageEvent) => {
      const body = gridMessage(event, documentId);
      if (!body) return;
      if (body.type === "ready") {
        postToGrid(documentId, request);
        return;
      }
      if (body.requestId !== request.requestId) return;
      const parsed = body.failed === true ? null : parse(body);
      finish(() => parsed === null ? reject(new Error("The collection could not be read.")) : resolve(parsed));
    };
    const timeout = window.setTimeout(
      () => finish(() => reject(new Error("The collection did not answer."))),
      timeoutMs,
    );
    if (signal.aborted) {
      onAbort();
      return;
    }
    window.addEventListener("message", onMessage);
    signal.addEventListener("abort", onAbort, { once: true });
    postToGrid(documentId, request);
  });
}

function requestChartColumns(documentId: string, signal: AbortSignal): Promise<ChartColumn[]> {
  return requestFromGrid(
    documentId,
    { type: "chemicalSpaceRequestColumns", requestId: `chart-columns-${crypto.randomUUID()}`, includeAllColumns: true },
    (body) => {
      if (!Array.isArray(body.columns)) return null;
      return body.columns.flatMap((value): ChartColumn[] => {
        const column = value as { id?: unknown; label?: unknown; type?: unknown } | null;
        if (typeof column?.id !== "string" || typeof column.label !== "string") return [];
        return [{ id: column.id, label: column.label, type: column.type === "number" ? "number" : "text" }];
      });
    },
    signal,
    COLUMNS_TIMEOUT_MS,
  );
}

function boundedIds(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  return value.slice(0, COLLECTION_CHART_ROW_LIMIT).map(Number).filter(id => Number.isSafeInteger(id) && id >= 0);
}

function sameIds(left: readonly number[], right: readonly number[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

// The filter model is the only notice the grid gives when a column appears or
// its values arrive without an edit (descriptors, analyses). It is also sent on
// every filter change, so only the value ranges of the charted columns count.
function chartedValuesSignature(model: unknown, requests: readonly ChartColumnRequest[]) {
  const columns = (model as { columns?: unknown } | null)?.columns;
  if (!Array.isArray(columns)) return "[]";
  const charted = new Set(requests.map(request => request.id));
  return JSON.stringify(columns
    // A paged collection reports the range of its loaded pages, which moves with scrolling.
    .filter(column => charted.has(column?.id) && typeof column.min === "number" && column.statsRows === undefined)
    .map(column => [column.id, column.min, column.max, column.bins]));
}

/**
 * Columns, rows, selection and filter state of one collection for the Chart tab.
 * `columnsToRead` says which columns the chart draws once the catalog is known.
 * While `active` is false the chart keeps what it has and asks for nothing.
 */
export function useCollectionChartSource(
  documentId: string,
  active: boolean,
  columnsToRead: (columns: readonly ChartColumn[]) => readonly ChartColumnRequest[],
) {
  const subscriberId = useMemo(() => crypto.randomUUID(), []);
  const [columns, setColumns] = useState<ChartColumn[] | null>(null);
  const requests = useMemo(() => columns ? columnsToRead(columns) : [], [columns, columnsToRead]);
  const [table, setTable] = useState<ChartTable | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selectedIds, setSelectedIds] = useState<readonly number[]>([]);
  const [visibleIds, setVisibleIds] = useState<readonly number[] | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [preview, setPreview] = useState<ChartMoleculePreview | null>(null);
  const [columnsEpoch, setColumnsEpoch] = useState(0);
  const [dataEpoch, setDataEpoch] = useState(0);
  const requestsRef = useRef(requests);
  requestsRef.current = requests;
  const loadedEpoch = useRef(-1);
  const tableRef = useRef(table);
  tableRef.current = table;
  const valuesSignature = useRef("[]");

  useEffect(() => {
    if (!active) return;
    let columnsTimer = 0;
    const subscribe = () => {
      postToGrid(documentId, { type: "chemicalSpaceVisibilitySubscription", subscriberId, active: true });
      postToGrid(documentId, { type: "chemicalSpaceRequestState" });
      // Edits made while the chart was hidden show up as a newer revision.
      postToGrid(documentId, { type: "chemicalSpaceRequestIndexState", requestId: `chart-revision-${subscriberId}` });
    };
    const onMessage = (event: MessageEvent) => {
      const body = gridMessage(event, documentId);
      if (!body) return;
      if (body.type === "ready") {
        subscribe();
        setColumnsEpoch(epoch => epoch + 1);
        setDataEpoch(epoch => epoch + 1);
      } else if (body.type === "gridMenuStateChanged") {
        const ids = boundedIds(body.selectedSourceIndexes);
        if (ids) setSelectedIds(current => sameIds(current, ids) ? current : ids);
      } else if (body.type === "chemicalSpaceVisibilityChanged") {
        const ids = body.kind === "filtered" ? boundedIds(body.sourceRecordIds) : null;
        // The grid repeats its filter state after every selection; equal ids keep the chart as it is.
        setVisibleIds(current => current && ids ? sameIds(current, ids) ? current : ids : ids);
      } else if (body.type === "gridDirtyChanged" || body.type === "chemicalSpaceIndexState") {
        // Rows read at another revision are stale; a read still in flight was
        // dropped by the grid and has to be asked for again.
        const revision = Number(body.sourceRevision);
        if (Number.isSafeInteger(revision) && tableRef.current?.sourceRevision !== revision) {
          setDataEpoch(epoch => epoch + 1);
        }
      } else if (body.type === "gridFilterModel") {
        window.clearTimeout(columnsTimer);
        columnsTimer = window.setTimeout(() => setColumnsEpoch(epoch => epoch + 1), 200);
        const signature = chartedValuesSignature(body.model, requestsRef.current);
        if (signature !== valuesSignature.current) {
          valuesSignature.current = signature;
          setDataEpoch(epoch => epoch + 1);
        }
      } else if (body.type === "gridHoverChanged") {
        const id = Number(body.sourceRecordId);
        setHoveredId(body.sourceRecordId != null && Number.isSafeInteger(id) && id >= 0 ? id : null);
      } else if (body.type === "chemicalSpaceMoleculePreview") {
        const id = Number(body.sourceRecordId);
        if (body.sourceRecordId == null || !Number.isSafeInteger(id) || id < 0) {
          setPreview(null);
          return;
        }
        const svg = typeof body.svgBase64 === "string" && body.svgBase64.length <= MAX_PREVIEW_BASE64_BYTES
          ? body.svgBase64
          : "";
        setPreview({
          sourceRecordId: id,
          name: typeof body.name === "string" ? body.name : "",
          smiles: typeof body.smiles === "string" ? body.smiles : "",
          svgUrl: svg ? `data:image/svg+xml;base64,${svg}` : null,
        });
      }
    };
    window.addEventListener("message", onMessage);
    subscribe();
    return () => {
      window.clearTimeout(columnsTimer);
      window.removeEventListener("message", onMessage);
      postToGrid(documentId, { type: "chemicalSpaceVisibilitySubscription", subscriberId, active: false });
    };
  }, [active, documentId, subscriberId]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    requestChartColumns(documentId, controller.signal).then((next) => {
      setColumns(current => current && JSON.stringify(current) === JSON.stringify(next) ? current : next);
    }).catch(() => {
      // An unanswered catalog leaves the previous columns; the grid's next
      // ready or model message asks again.
      if (!controller.signal.aborted) setColumns(current => current ?? []);
    });
    return () => controller.abort();
  }, [active, columnsEpoch, documentId]);

  const requestsKey = requests.map(chartSeriesKey).join("\n");
  useEffect(() => {
    const wanted = requestsRef.current;
    if (!active || wanted.length === 0) return;
    if (loadedEpoch.current === dataEpoch && table && wanted.every(request => table.series.has(chartSeriesKey(request)))) return;
    const controller = new AbortController();
    setLoading(true);
    requestFromGrid(
      documentId,
      { type: "collectionChartRequestData", requestId: `chart-data-${crypto.randomUUID()}`, subscriberId, columns: wanted },
      body => chartTableFromBridge(body, wanted),
      controller.signal,
      DATA_TIMEOUT_MS,
    ).then((next) => {
      loadedEpoch.current = dataEpoch;
      setTable(next);
      setFailed(false);
      setLoading(false);
    }).catch(() => {
      if (controller.signal.aborted) return;
      setFailed(true);
      setLoading(false);
    });
    return () => controller.abort();
    // `table` is read to skip a request it already answers, not to trigger one.
  }, [active, dataEpoch, documentId, requestsKey, subscriberId]);

  const select = useCallback((ids: number[], focusId: number | null = null) => {
    const bounded = ids.slice(0, COLLECTION_CHART_ROW_LIMIT);
    setSelectedIds(bounded);
    postToGrid(documentId, {
      type: "chemicalSpaceSelectionChanged",
      sourceRecordIds: bounded,
      filterToSelection: false,
      focusSourceRecordId: focusId,
    });
    // The inspector summarises a selection made outside the grid from this event.
    window.dispatchEvent(new CustomEvent("burette:chemical-space-selection", {
      detail: { documentId, sourceRecordIds: bounded },
    }));
  }, [documentId]);

  const hover = useCallback((id: number | null) => {
    setHoveredId(id);
    setPreview(current => current?.sourceRecordId === id ? current : null);
    postToGrid(documentId, { type: "chemicalSpaceHoverChanged", sourceRecordId: id });
  }, [documentId]);

  const retry = useCallback(() => {
    setFailed(false);
    setColumnsEpoch(epoch => epoch + 1);
    setDataEpoch(epoch => epoch + 1);
  }, []);

  return { columns, table, loading, failed, selectedIds, visibleIds, hoveredId, preview, select, hover, retry };
}
