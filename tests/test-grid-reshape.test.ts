import { expect, test } from "bun:test";
import { NAME_COLUMN, columnKey, mergeRowEdits, pivotRowEdits, tableRows, unpivotRowEdits, type ReshapeColumn } from "../apps/desktop/src/lib/grid-reshape";
import type { GridRowEdits, GridTable } from "../apps/desktop/src/lib/grid-table-bridge";
import { fixtureText as fixture, functionSource, sdfRows, type GridRow } from "./fixtures/table-shaping/grid-functions";
import { mergeByKey, parseDelimitedTable, parseSdfDataTable, pivotTable, unpivotTable, type TableRow } from "../apps/desktop/src/lib/table-shaping";

// Pivot, Unpivot and Merge File by Key cross two runtimes: the host works the
// table out and the grid applies it as row edits. This runs both halves on the
// fixtures - the grid's functions lifted out of the viewer, the way
// test-grid-table-operations.mjs does - and checks that what the grid holds
// afterwards is the table the pure operation promised.
type Message = { type: string } & Record<string, unknown>;

const LIFTED = [
  "markGridDirty", "snapshotGridEditState", "restoreGridEditState", "pushGridEditHistoryEntry", "pushUndoSnapshot",
  "insertAfterRow", "nextGridRowIndex", "applyVirtualGridEdits", "stripDeletedPropColumns", "materializeRemoteCollectionRows",
  "currentLocalCollectionRows", "collectCurrentCollectionRows", "tableColumnRawDisplayValue",
  "postGridTable", "editedRowProps", "planGridRowEdits", "applyGridRowEdits",
];

function grid(rows: GridRow[], remote = false) {
  const state = {
    rows: remote ? rows.slice(0, 4) : rows.slice(), all: remote ? [] : rows.slice(), source: rows, remoteMode: remote,
    totalRows: rows.length, recordsTotalHint: remote ? rows.length : null,
    hiddenRows: new Set<number>(), deletedPropColumns: new Set<string>(), selected: new Set<number>(),
    rowPatches: new Map(), insertedRows: [] as GridRow[], columnValueRanges: new Map(),
    undoStack: [] as Array<{ label: string }>, redoStack: [], svgCache: new Map(), xyzrenderCardCache: new Map(),
    dirty: false, dirtyReason: "", sourceRevision: 0, closeTransitionActive: false, saveAsPending: false,
  };
  const messages: Message[] = [];
  const api = new Function("state", "messages", `
    const GRID_EDIT_HISTORY_LIMIT = 50;
    function capabilities() { return { editing: true }; }
    function safeConfig() { return { documentId: 'doc' }; }
    function invalidateTableColumnCatalog() {}
    function syncGridEditControls() {}
    function notifyGridMenuState() {}
    function notifyGridDirty() {}
    function setStatus(message) { messages.push({ type: 'status', message }); }
    function render() {}
    function refresh() {}
    function requireCollectionIndexReady() { return true; }
    function applyColumnValueRanges(row) { return row; }
    function rowSmiles() { return ''; }
    function post(type, message, payload) { messages.push({ type, ...payload }); }
    // A paged collection hands out every source row, edits already applied.
    async function collectAllRemoteRows() { return applyVirtualGridEdits(state.source); }
    ${LIFTED.map(functionSource).join("\n")}
    return {
      postGridTable, applyGridRowEdits,
      rows: () => (state.remoteMode ? materializeRemoteCollectionRows(applyVirtualGridEdits(state.source)) : currentLocalCollectionRows()),
      undo() { const entry = state.undoStack.pop(); restoreGridEditState(entry.snapshot); return entry.label; },
    };
  `)(state, messages) as {
    postGridTable: (body: unknown, cfg: unknown) => Promise<void>;
    applyGridRowEdits: (body: unknown, cfg: unknown) => Promise<void>;
    rows: () => GridRow[];
    undo: () => string;
  };
  // The host's two requests, answered the way the bridge reads the replies.
  const read = async (columns: ReshapeColumn[]): Promise<GridTable> => {
    await api.postGridTable({ requestId: "read", columnIds: columns.map((column) => column.id) }, {});
    const reply = messages.pop()!;
    expect(reply.type).toBe("gridTable");
    return {
      sourceRevision: reply.sourceRevision as number,
      rows: (reply.rows as Array<[number, ...string[]]>).map(([index, ...cells]) => ({ index, cells })),
    };
  };
  const apply = async (edits: GridRowEdits) => {
    await api.applyGridRowEdits({ requestId: "apply", ...edits }, {});
    return messages.splice(0);
  };
  return { state, api, read, apply };
}

const columnsOf = (names: string[]): ReshapeColumn[] => [NAME_COLUMN, ...names.map((name) => ({ id: `prop:${name}`, label: name, type: "text" as const }))];
const propsBag = (rows: ReadonlyArray<{ props: TableRow }>) => rows.map((row) => JSON.stringify(Object.entries(row.props).sort())).sort();
const bag = (rows: readonly TableRow[]) => propsBag(rows.map((props) => ({ props })));
const prop = (name: string) => columnKey({ id: `prop:${name}` });

test("a pivot applied by the grid is the pivoted table, one undo entry, and unpivot brings the rows back", async () => {
  const source = sdfRows("chembl-assays-long.sdf");
  const { state, api, read, apply } = grid(source);
  const columns = columnsOf(["ChEMBL ID", "Assay", "pChEMBL"]);
  const table = await read(columns);
  expect(table.rows.length).toBe(9);
  const rows = tableRows(table, columns);
  expect(rows[0]).toEqual({ [columnKey(NAME_COLUMN)]: "Aspirin", "ChEMBL ID": "CHEMBL25", Assay: "COX-1", pChEMBL: "5.8" });

  const pivoted = pivotTable(rows, { keyColumn: "ChEMBL ID", categoryColumn: "Assay", valueColumn: "pChEMBL" });
  expect(pivoted.columns).toEqual(["COX-1", "COX-2"]);
  expect(pivoted.duplicateCells).toEqual([{ key: "CHEMBL25", category: "COX-1", values: ["5.8", "6.0"] }]);
  expect(pivoted.emptyKeyRows).toEqual([8]);
  const messages = await apply({ label: "Pivot", summary: "Pivoted.", sourceRevision: table.sourceRevision, ...pivotRowEdits(table, pivoted, ["Assay", "pChEMBL"]) });
  expect(messages).toEqual([
    { type: "status", message: "[grid] Pivoted." },
    { type: "gridRowEditsApplied", requestId: "apply", patched: 4, inserted: 0, hidden: 4 },
  ]);
  expect(api.rows().map((row) => [row.name, row.props])).toEqual([
    ["Aspirin", { "ChEMBL ID": "CHEMBL25", "COX-1": "5.8; 6.0", "COX-2": "4.6" }],
    ["Ibuprofen", { "ChEMBL ID": "CHEMBL521", "COX-1": "5.3" }],
    ["Naproxen", { "ChEMBL ID": "CHEMBL154", "COX-2": "6.1" }],
    ["Diclofenac", { "ChEMBL ID": "CHEMBL139", "COX-1": "6.9", "COX-2": "7.4" }],
    // No key: not part of the pivot, so it keeps the cells it had.
    ["Benzene", { Assay: "COX-1", pChEMBL: "3.0" }],
  ]);
  const name = columnKey(NAME_COLUMN);
  expect(bag(api.rows().map((row) => ({ ...row.props, [name]: row.name })))).toEqual(bag(pivoted.rows));
  expect(state.undoStack.map((entry) => entry.label)).toEqual(["Pivot"]);
  expect(state.dirty).toBe(true);

  // The edit was planned against the table as it was read; a second one from the same read is refused.
  expect(await apply({ label: "Pivot", summary: "", sourceRevision: table.sourceRevision, hide: [0] })).toEqual([
    { type: "gridRowEditsApplied", requestId: "apply", error: "The collection changed in the meantime. Run the command again." },
  ]);

  // Unpivot the two new columns, splitting the joined cell: every source row is back.
  const wideColumns = columnsOf(["ChEMBL ID", "Assay", "pChEMBL", "COX-1", "COX-2"]);
  const wide = await read(wideColumns);
  const options = { columns: ["COX-1", "COX-2"], categoryColumn: "Assay", valueColumn: "pChEMBL" };
  const unpivoted = unpivotTable(tableRows(wide, wideColumns), { ...options, separator: ";" });
  const applied = await apply({ label: "Unpivot", summary: "", sourceRevision: wide.sourceRevision, ...unpivotRowEdits(wide, unpivoted, options) });
  expect(applied).toEqual([{ type: "gridRowEditsApplied", requestId: "apply", patched: 4, inserted: 3, hidden: 0 }]);
  const restored = api.rows();
  // Naproxen's COX-1 row had no value, so it is the one row that does not return.
  expect(propsBag(restored)).toEqual(propsBag(source.filter((row) => row.props.pChEMBL)));
  // A row made by Unpivot is a copy of its source row: same molecule, a new index.
  const aspirin = restored.filter((row) => row.name === "Aspirin");
  expect(aspirin.map((row) => [row.index, row.molblock, row.props.Assay, row.props.pChEMBL])).toEqual([
    [0, "molblock 0", "COX-1", "5.8"],
    [9, "molblock 0", "COX-1", "6.0"],
    [10, "molblock 0", "COX-2", "4.6"],
  ]);

  expect(api.undo()).toBe("Unpivot");
  expect(api.undo()).toBe("Pivot");
  expect(api.rows()).toEqual(source);
  expect(state.dirty).toBe(false);
});

test("a merge applied by the grid matches the pandas reference in both duplicate modes", async () => {
  const fields = ["ChEMBL ID", "Class", "MW", "Source"];
  const columns = columnsOf(fields);
  const other = parseDelimitedTable(fixture("chembl-activities.csv"));
  for (const [duplicates, reference] of [["first", "merge-expected-first.csv"], ["expand", "merge-expected-expand.csv"]] as const) {
    const { api, read, apply } = grid(sdfRows("chembl-compounds.sdf"));
    const table = await read(columns);
    const merged = mergeByKey(tableRows(table, columns), other.rows, {
      leftKey: prop("ChEMBL ID"), rightKey: "molecule_chembl_id", duplicates, existingColumns: fields,
    });
    const [reply] = (await apply({ label: "Merge File by Key", summary: "", sourceRevision: table.sourceRevision, ...mergeRowEdits(table, merged) })).slice(-1);
    expect(reply).toEqual({ type: "gridRowEditsApplied", requestId: "apply", patched: 7, inserted: duplicates === "expand" ? 2 : 0, hidden: 0 });
    const expected = parseDelimitedTable(fixture(reference));
    const rows = api.rows();
    expect(rows.length).toBe(expected.rows.length);
    // The grid keeps a copy next to the row it was made from, which is the order pandas writes.
    rows.forEach((row, position) => {
      expect([position, row.props]).toEqual([position, expected.rows[position]]);
    });
    expect(api.undo()).toBe("Merge File by Key");
    expect(api.rows().map((row) => row.props)).toEqual(parseSdfDataTable(fixture("chembl-compounds.sdf")).rows);
  }
});

test("a paged collection takes the same edit through patches, hidden rows and inserted rows", async () => {
  const source = sdfRows("chembl-assays-long.sdf");
  const { state, api, read, apply } = grid(source, true);
  const columns = columnsOf(["ChEMBL ID", "Assay", "pChEMBL"]);
  const table = await read(columns);
  expect(table.rows.length).toBe(9);
  const pivoted = pivotTable(tableRows(table, columns), { keyColumn: "ChEMBL ID", categoryColumn: "Assay", valueColumn: "pChEMBL", duplicates: "first" });
  await apply({ label: "Pivot", summary: "", sourceRevision: table.sourceRevision, ...pivotRowEdits(table, pivoted, ["Assay", "pChEMBL"]) });
  expect([...state.hiddenRows].sort()).toEqual([1, 4, 6, 7]);
  expect(state.totalRows).toBe(5);
  expect(state.recordsTotalHint).toBe(5);
  // Only the first page is loaded, and it shows the edit at once.
  expect(state.rows.map((row) => [row.index, row.props])).toEqual([
    [0, { "ChEMBL ID": "CHEMBL25", "COX-1": "5.8", "COX-2": "4.6" }],
    [2, { "ChEMBL ID": "CHEMBL521", "COX-1": "5.3" }],
    [3, { "ChEMBL ID": "CHEMBL154", "COX-2": "6.1" }],
  ]);

  const wideColumns = columnsOf(["ChEMBL ID", "COX-1", "COX-2"]);
  const wide = await read(wideColumns);
  const options = { columns: ["COX-1", "COX-2"], categoryColumn: "Assay", valueColumn: "pChEMBL" };
  await apply({ label: "Unpivot", summary: "", sourceRevision: wide.sourceRevision, ...unpivotRowEdits(wide, unpivotTable(tableRows(wide, wideColumns), options), options) });
  expect(state.insertedRows.map((row) => [row.index, row.props.Assay])).toEqual([[10, "COX-2"], [9, "COX-2"]]);
  expect(state.totalRows).toBe(7);
  // What a save would write: every surviving row, patched, and the inserted ones.
  const first = new Set<string>();
  expect(propsBag(api.rows())).toEqual(propsBag(source.filter((row) => {
    const id = `${row.props["ChEMBL ID"]}|${row.props.Assay}`;
    if (!row.props.pChEMBL || (row.props["ChEMBL ID"] && first.has(id))) return false;
    first.add(id);
    return true;
  })));
});
