import { readFileSync } from "node:fs";

// The grid side is the production code of grid-viewer.js: the chart request
// handler and the column accessors it reads through, run against a state object
// shaped like the grid's own.
const gridSource = readFileSync("PreviewExtension/Web/grid-viewer.js", "utf8");
if (readFileSync("plugins/burette-agent/preview-web/grid-viewer.js", "utf8") !== gridSource) {
  throw new Error("plugins/burette-agent/preview-web/grid-viewer.js is not a copy of PreviewExtension/Web/grid-viewer.js");
}
function functionSource(name: string) {
  const match = new RegExp(`\\n  (?:async )?function ${name}\\(`, "u").exec(gridSource);
  if (!match) throw new Error(`missing production function ${name}`);
  const rest = gridSource.slice(match.index + 1);
  return rest.slice(0, rest.search(/\n {2}(?:async )?function [A-Za-z_$]/u));
}
const gridFunctions = [
  "postCollectionChartData", "currentLocalCollectionRows", "applyVirtualGridEdits", "stripDeletedPropColumns",
  "applyColumnValueRanges", "tableColumnNumericValue", "tableColumnRawNumericValue", "tableColumnDisplayValue",
  "tableColumnRawDisplayValue", "clampToValueRange", "clampTextToValueRange", "descriptorNumericValue", "loadBatchSize",
];

export type GridRow = { index: number; name?: string; props?: Record<string, string>; descriptors?: Record<string, { value: number }> };
export type Posted = { type: string } & Record<string, any>;

export function createGrid(rows: GridRow[], remote: { pageSize: number } | null = null) {
  const state = {
    remoteMode: Boolean(remote), all: remote ? [] : rows, rows: remote ? rows.slice(0, 2) : rows,
    hiddenRows: new Set<number>(), rowPatches: new Map(), insertedRows: [] as GridRow[],
    deletedPropColumns: new Set<string>(), columnValueRanges: new Map(), sourceRevision: 0,
    collectionChartRequests: new Map<string, string>(),
  };
  const posted: Posted[] = [];
  const pageRequests: Array<Record<string, unknown>> = [];
  let releasePage: (() => void) | null = null;
  const gate = { held: false };
  const api = new Function("state", "post", "hostRequest", "safeConfig", `
    const GRID_SELECTION_BRIDGE_LIMIT = 100000;
    const COLLECTION_CHART_COLUMN_LIMIT = 6;
    const COLLECTION_CHART_TEXT_LIMIT = 120;
    function rowSmiles(row) { return row.smiles || ''; }
    function descriptorDisplayValue(value) { return value ? String(value.value) : ''; }
    function analysisDisplayValue() { return ''; }
    ${gridFunctions.map(functionSource).join("\n")}
    return { postCollectionChartData };
  `)(
    state,
    (type: string, _message: string, payload: Record<string, unknown>) => posted.push({ type, ...payload }),
    async (type: string, payload: { offset: number; limit: number }) => {
      pageRequests.push({ type, ...payload });
      if (gate.held) await new Promise<void>((resolve) => { releasePage = resolve; });
      // The desktop store never returns more than its page limit.
      const limit = Math.min(payload.limit, remote!.pageSize);
      return { rows: rows.slice(payload.offset, payload.offset + limit), totalRows: rows.length };
    },
    () => ({ documentId: "grid" }),
  ) as { postCollectionChartData: (body: Record<string, unknown>, cfg: Record<string, unknown>) => Promise<void> };
  return {
    state, posted, pageRequests, gate,
    release: () => releasePage?.(),
    request: (body: Record<string, unknown>) => api.postCollectionChartData(body, { documentId: "grid", pageSize: remote?.pageSize }),
  };
}

