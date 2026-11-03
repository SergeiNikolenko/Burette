import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("PreviewExtension/Web/grid-viewer.js", "utf8");
function body(name) {
  const start = source.search(new RegExp(`\\n  (?:async )?function ${name}\\(`));
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
  return { rows: [{ index: 0, name: "Original", props: { score: "1" } }], visibleCount: 1, all: [], totalRows: 2, recordsTotalHint: 2,
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

// The receiving toolbar must reflect the restored view before the new table
// renders; a snapshot changes state without going through its UI setters.
const steps = [];
const transferState = { visibleCount: 450 };
const transfer = new Function("state", "steps", `
  const config = () => ({});
  const collectionIndexReady = () => true;
  const restoreGridWindowState = () => { state.viewMode = 'table'; steps.push('restore'); return 42; };
  const refreshGridControls = () => { steps.push('controls:' + state.viewMode); };
  const applyGridPreferences = () => { steps.push('preferences:' + state.viewMode); };
  const render = async (_cfg, options) => {
    if (options?.visibleCount !== 450) throw new Error('Transfer discarded the loaded row extent');
    steps.push('render:' + state.viewMode);
  };
  const window = { scrollTo: ({ top }) => steps.push('scroll:' + top) };
  const notifyGridMenuState = () => steps.push('menu');
  const post = (_type, _id, result) => { if (!result.ok) throw new Error(result.error); steps.push('ack'); };
  ${body("handleGridWindowTransfer")}
  return handleGridWindowTransfer;
`)(transferState, steps);
await transfer({ type: "gridWindowRestore", requestId: "restore-one", snapshot: "fixture" });
assert.deepEqual(steps, ['restore', 'controls:table', 'preferences:table', 'render:table', 'scroll:42', 'menu', 'ack']);
steps.length = 0;
await transfer({ type: "gridWindowRestore", requestId: "restore-one", snapshot: "fixture" });
assert.deepEqual(steps, ['menu', 'ack'], 'repeated acknowledgement must not reset user view');

// Execute the real render reset as well as capture/restore. A virtual renderer
// can only provide scroll height for rows exposed by visibleCount.
const deep = state();
deep.rows = Array.from({ length: 600 }, (_, index) => ({ index }));
deep.visibleCount = 450;
const deepReceiver = state();
runtime(deepReceiver).restore(runtime(deep).capture());
assert.equal(deepReceiver.visibleCount, 450);
deepReceiver.remoteMode = true;
deepReceiver.token = 0;
let renderedHeight = 0;
const realRender = new Function('state', 'recordHeight', `
  const document = { getElementById: () => ({ innerHTML: '' }) };
  const root = { querySelector: () => null };
  const cancelVirtualWindowRender = () => {};
  const resetRdkitCardObserver = () => {};
  const resetXyzrenderCardObserver = () => {};
  const resetCardRenderQueues = () => {};
  const loadBatchSize = () => 100;
  const renderVirtualWindow = async () => recordHeight(state.visibleCount * 40);
  ${body('render')}
  return render;
`)(deepReceiver, height => { renderedHeight = height; });
await realRender({}, { visibleCount: deepReceiver.visibleCount });
assert.equal(renderedHeight, 18000, 'transferred loaded rows must define the initial scroll extent');
await realRender({});
assert.equal(renderedHeight, 4000, 'ordinary refresh still starts from its first batch');
const malformedCount = JSON.parse(runtime(deep).capture());
malformedCount.visibleCount = 601;
assert.throws(() => runtime(deepReceiver).restore(JSON.stringify(malformedCount)), /visible row count/);
delete malformedCount.visibleCount;
runtime(deepReceiver).restore(JSON.stringify(malformedCount));
assert.equal(deepReceiver.visibleCount, 600, 'legacy snapshots retain all transferred rows');
