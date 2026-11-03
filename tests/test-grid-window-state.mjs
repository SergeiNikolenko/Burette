import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("PreviewExtension/Web/grid-viewer.js", "utf8");
function body(name) {
  const start = source.indexOf(`\n  function ${name}(`);
  assert.notEqual(start, -1);
  const rest = source.slice(start + 1);
  return rest.slice(0, rest.search(/\n {2}(?:async )?function [A-Za-z_$]/u));
}
function runtime(state) {
  return new Function("state", `
    const GRID_EDIT_HISTORY_LIMIT = 50;
    const document = { getElementById: () => null };
    function scrollTop() { return 1200; }
    function invalidateTableColumnCatalog() {}
    function notifyGridDirty() {}
    function syncGridEditControls() {}
    ${["snapshotGridEditState", "restoreGridEditState", "captureGridWindowState", "restoreGridWindowState", "gridWindowViewKeys"].map(body).join("\n")}
    return { capture: captureGridWindowState, restore: restoreGridWindowState, snapshot: snapshotGridEditState };
  `)(state);
}
function state() {
  return { rows: [{ index: 0, name: "Original", props: { score: "1" } }], all: [], totalRows: 2, recordsTotalHint: 2,
    hiddenRows: new Set([1]), deletedPropColumns: new Set(["obsolete"]), selected: new Set([0]),
    rowPatches: new Map([[0, { name: "Edited", props: { score: "9" } }]]), insertedRows: [{ index: 2, name: "New" }],
    columnValueRanges: new Map([["score", { min: 0, max: 10 }]]), dirty: true, dirtyReason: "edited cells", sourceRevision: 4,
    undoStack: [], redoStack: [], query: "Edited", sort: "name", smarts: "C", viewMode: "table",
    tableHiddenColumns: new Set(["index"]), tablePinnedColumns: new Set(["name"]), tableColumnWidths: { name: 180 },
    tableColumnFilters: { score: { min: 2 } }, descriptorFilters: [], descriptorSort: null,
    svgCache: new Map(), xyzrenderCardCache: new Map(), smartsMatches: new Map(),
  };
}
const original = state();
const from = runtime(original);
original.undoStack.push({ label: "Edit score", snapshot: from.snapshot() });
original.redoStack.push({ label: "Remove row", snapshot: from.snapshot() });
const receiver = state(); receiver.query = ""; receiver.rowPatches.clear(); receiver.hiddenRows.clear();
receiver.selected.clear(); receiver.tablePinnedColumns.clear(); receiver.dirty = false;
const to = runtime(receiver);
const snapshot = from.capture();
assert.equal(to.restore(snapshot), 1200);
assert.deepEqual(to.snapshot(), from.snapshot());
assert.deepEqual(receiver.undoStack, original.undoStack);
assert.deepEqual(receiver.redoStack, original.redoStack);
assert.deepEqual([receiver.query, receiver.sort, receiver.viewMode, receiver.tablePinnedColumns, receiver.tableColumnFilters],
  [original.query, original.sort, original.viewMode, original.tablePinnedColumns, original.tableColumnFilters]);
const before = to.capture();
const invalid = JSON.parse(snapshot); invalid.edit.rowPatches = [];
assert.throws(() => to.restore(JSON.stringify(invalid)), /Invalid collection/);
assert.equal(to.capture(), before, "invalid snapshot does not partially mutate the receiver");
original.rows[0].name = "x".repeat(1600 * 1024);
assert.throws(() => from.capture(), /too large/);
console.log("Grid window state: edits, history, selection, view and bounded validation passed.");
