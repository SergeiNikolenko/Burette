import assert from "node:assert/strict";
import fs from "node:fs";

// The DataWarrior table operations that mutate rows and columns live in the
// grid viewer, because that is where the collection's virtual edit layer is.
// They are checked here the way the save materializer is: by lifting the exact
// source of each function out of the viewer and running it over a fake state.
const viewerSource = fs.readFileSync("PreviewExtension/Web/grid-viewer.js", "utf8");

function functionSource(name) {
  const start = [`\n  function ${name}(`, `\n  async function ${name}(`]
    .map((needle) => viewerSource.indexOf(needle))
    .filter((index) => index !== -1)
    .sort((left, right) => left - right)[0];
  assert.notEqual(start, undefined, `missing ${name}`);
  const rest = viewerSource.slice(start + 1);
  const end = rest.search(/\n {2}(?:async )?function [A-Za-z_$]/u);
  assert.notEqual(end, -1, `missing function after ${name}`);
  return rest.slice(0, end);
}

// Everything a mutating operation touches outside itself: the undo stack, the
// caches it invalidates and the dirty flag it raises. Rendering and the paging
// that feeds a remote collection are stubbed, so what is under test is the edit
// each operation makes and nothing else.
function harness(state, names, stubs = "") {
  return new Function(
    "state",
    "statuses",
    `
    const GRID_EDIT_HISTORY_LIMIT = 50;
    function capabilities() { return { editing: true }; }
    function safeConfig() { return { documentId: 'doc' }; }
    function invalidateTableColumnCatalog() { state.tableColumnCatalogCache = null; }
    function syncGridEditControls() {}
    function notifyGridMenuState() {}
    function notifyGridDirty() {}
    function setStatus(message, kind) { statuses.push({ message, kind: kind || 'info' }); }
    function render() { state.renders = (state.renders || 0) + 1; }
    function refresh() { state.refreshes = (state.refreshes || 0) + 1; }
    function requireCollectionIndexReady() { return state.indexBlocked !== true; }
    async function collectAllRemoteRows() { return (state.collected || state.rows).map(row => ({ ...row })); }
    ${stubs}
    ${functionSource("markGridDirty")}
    ${functionSource("snapshotGridEditState")}
    ${functionSource("restoreGridEditState")}
    ${functionSource("pushGridEditHistoryEntry")}
    ${functionSource("pushUndoSnapshot")}
    ${names.map((name) => functionSource(name)).join("\n")}
    return {
      ${names.map((name) => `${name}`).join(",\n      ")},
      undo() {
        const entry = state.undoStack.pop();
        if (!entry) throw new Error('nothing to undo');
        restoreGridEditState(entry.snapshot);
        return entry.label;
      },
    };
    `,
  )(state, state.statuses);
}

function gridState(overrides = {}) {
  return {
    statuses: [],
    rows: [],
    all: [],
    totalRows: 0,
    recordsTotalHint: null,
    hiddenRows: new Set(),
    deletedPropColumns: new Set(),
    selected: new Set(),
    rowPatches: new Map(),
    insertedRows: [],
    columnValueRanges: new Map(),
    undoStack: [],
    redoStack: [],
    svgCache: new Map(),
    xyzrenderCardCache: new Map(),
    tableColumnCatalogCache: null,
    remoteMode: false,
    dirty: false,
    dirtyReason: "",
    sourceRevision: 0,
    closeTransitionActive: false,
    ...overrides,
  };
}

// --- Set Value Range -------------------------------------------------------
{
  const state = gridState();
  const grid = harness(state, [
    "setGridColumnValueRange",
    "parseValueRangeBound",
    "clampToValueRange",
    "clampTextToValueRange",
    "applyColumnValueRanges",
  ]);

  assert.equal(grid.parseValueRangeBound("  "), null, "a blank limit is no limit");
  assert.equal(grid.parseValueRangeBound("-2.5"), -2.5);
  assert.ok(Number.isNaN(grid.parseValueRangeBound("abc")), "a limit that is not a number must be refused, not ignored");

  const range = { min: 0, max: 10 };
  assert.equal(grid.clampToValueRange(-4, range), 0);
  assert.equal(grid.clampToValueRange(14, range), 10);
  assert.equal(grid.clampToValueRange(4, range), 4);
  assert.ok(Number.isNaN(grid.clampToValueRange(Number.NaN, range)), "a missing value stays missing");
  assert.equal(grid.clampToValueRange(-4, { min: null, max: 10 }), -4, "a blank lower limit leaves small values alone");

  assert.equal(grid.clampTextToValueRange("", range), "", "an empty cell must not become the lower limit");
  assert.equal(grid.clampTextToValueRange("   ", range), "   ");
  assert.equal(grid.clampTextToValueRange("<0.1", range), "<0.1", "a censored value is not a number and is left alone");
  assert.equal(grid.clampTextToValueRange("12.5", range), "10");
  assert.equal(grid.clampTextToValueRange("3.25", range), "3.25", "an in-range cell keeps the text it had");

  const applied = grid.setGridColumnValueRange("prop:IC50", "1", "5");
  assert.deepEqual(applied, { min: 1, max: 5 });
  assert.equal(state.undoStack.length, 1);
  assert.equal(state.undoStack[0].label, "Set Value Range");
  assert.equal(state.dirty, true, "a limit that reaches the saved file has to mark the grid dirty");
  const clamped = grid.applyColumnValueRanges({ index: 0, props: { IC50: "9.4", Name: "cmpd" } });
  assert.deepEqual(clamped.props, { IC50: "5", Name: "cmpd" }, "materialised rows carry the limit");
  assert.equal(
    grid.applyColumnValueRanges({ index: 1, props: { IC50: "2" } }).props.IC50,
    "2",
    "a row inside the range is returned untouched",
  );

  grid.undo();
  assert.equal(state.columnValueRanges.size, 0, "undo takes the value range off the column");
  assert.equal(state.dirty, false);
  assert.deepEqual(
    grid.applyColumnValueRanges({ index: 0, props: { IC50: "9.4" } }).props.IC50,
    "9.4",
    "the collection still holds every value it had",
  );

  assert.equal(grid.setGridColumnValueRange("prop:IC50", "5", "1"), false, "an inverted range is refused");
  assert.equal(grid.setGridColumnValueRange("prop:IC50", "x", ""), false, "a limit that is not a number is refused");
  assert.equal(state.undoStack.length, 0, "a refused range must not leave an undo entry behind");
  assert.equal(state.statuses.filter((entry) => entry.kind === "error").length, 2);

  grid.setGridColumnValueRange("prop:IC50", "1", "5");
  assert.equal(grid.setGridColumnValueRange("prop:IC50", "", ""), null, "two blank limits clear the range");
  assert.equal(state.columnValueRanges.size, 0);
}

// A value range belongs to the collection that was open, so loading another one
// must not carry it over.
{
  assert.match(
    viewerSource,
    /function resetDocumentRuntimeState\(\)[\s\S]*state\.columnValueRanges = new Map\(\);/u,
    "resetDocumentRuntimeState must clear the value ranges with the rest of the edit state",
  );
}

// --- Split Multiple Value Rows ---------------------------------------------
{
  const state = gridState();
  const grid = harness(state, ["splitCellValues", "planMultipleValueRowSplit"]);

  assert.deepEqual(grid.splitCellValues("5.2; 7.1 ;;9", ";"), ["5.2", "7.1", "9"], "blank parts are not rows");
  assert.deepEqual(grid.splitCellValues("", ";"), [], "an empty cell has nothing to split");
  assert.deepEqual(grid.splitCellValues("   ", ";"), []);
  assert.deepEqual(grid.splitCellValues("5.2", ";"), ["5.2"]);

  const rows = [
    { index: 0, name: "A", smiles: "CC", molblock: "", props: { IC50: "5.2; 7.1", Assay: "AZ" } },
    { index: 1, name: "B", smiles: "CO", molblock: "", props: { IC50: "3", Assay: "AZ" } },
    { index: 2, name: "C", smiles: "CN", molblock: "", props: { IC50: "1;2;3", Assay: "BZ" } },
  ];
  const plan = grid.planMultipleValueRowSplit(rows, "IC50", ";", 3);
  assert.deepEqual(plan.patches.map((patch) => [patch.index, patch.row.props.IC50]), [[0, "5.2"], [2, "1"]]);
  assert.deepEqual(
    plan.inserts.map((insert) => [insert.afterIndex, insert.row.index, insert.row.props.IC50]),
    [[0, 3, "7.1"], [2, 4, "2"], [2, 5, "3"]],
    "new rows are numbered past every row the operation saw",
  );
  assert.equal(plan.inserts[0].row.smiles, "CC", "a split row keeps the structure it came from");
  assert.equal(plan.inserts[0].row.props.Assay, "AZ", "every other column is copied");
  assert.deepEqual(rows[0].props, { IC50: "5.2; 7.1", Assay: "AZ" }, "planning must not touch the rows it read");
}

// Splitting a paged collection: the row that stays keeps its id through a
// patch, the new rows ride the same virtual insert Duplicate Molecule uses, and
// one undo entry takes the whole split back.
{
  const loaded = [
    { index: 0, name: "A", smiles: "CC", molblock: "", props: { IC50: "5.2; 7.1" } },
    { index: 1, name: "B", smiles: "CO", molblock: "", props: { IC50: "3" } },
  ];
  const state = gridState({
    remoteMode: true,
    rows: loaded.map((row) => ({ ...row })),
    totalRows: 2,
    recordsTotalHint: 2,
  });
  const grid = harness(state, [
    "splitGridMultipleValueRows",
    "splitCellValues",
    "planMultipleValueRowSplit",
    "nextGridRowIndex",
    "insertAfterRow",
    "applyVirtualGridEdits",
    "stripDeletedPropColumns",
    "applyColumnValueRanges",
    "clampTextToValueRange",
    "clampToValueRange",
  ]);

  await grid.splitGridMultipleValueRows(
    { columnId: "prop:IC50", columnLabel: "IC50", delimiter: ";" },
    { documentId: "doc" },
  );

  assert.deepEqual(
    state.rows.map((row) => [row.index, row.props.IC50]),
    [[0, "5.2"], [2, "7.1"], [1, "3"]],
    "the split shows at once, with the new row beside the one it came from",
  );
  assert.deepEqual(state.insertedRows.map((row) => row.index), [2], "the new row is part of the collection that gets saved");
  assert.equal(state.rowPatches.get(0).props.IC50, "5.2", "the original row keeps its id and takes the first value");
  assert.equal(state.totalRows, 3);
  assert.equal(state.recordsTotalHint, 3);
  assert.equal(state.dirty, true);
  assert.equal(state.undoStack.length, 1, "a split is one undo entry, not one per row");

  assert.equal(grid.undo(), "Split Multiple Value Rows");
  assert.deepEqual(state.rows.map((row) => [row.index, row.props.IC50]), [[0, "5.2; 7.1"], [1, "3"]]);
  assert.equal(state.insertedRows.length, 0);
  assert.equal(state.rowPatches.size, 0);
  assert.equal(state.totalRows, 2);
  assert.equal(state.recordsTotalHint, 2);
  assert.equal(state.dirty, false);
}

// Nothing to split leaves no undo entry and no dirty flag behind.
{
  const state = gridState({
    remoteMode: false,
    all: [{ index: 0, name: "A", smiles: "CC", molblock: "", props: { IC50: "5.2" } }],
    rows: [{ index: 0, name: "A", smiles: "CC", molblock: "", props: { IC50: "5.2" } }],
    totalRows: 1,
  });
  const grid = harness(state, [
    "splitGridMultipleValueRows",
    "splitCellValues",
    "planMultipleValueRowSplit",
    "nextGridRowIndex",
    "insertAfterRow",
    "applyVirtualGridEdits",
    "stripDeletedPropColumns",
    "applyColumnValueRanges",
    "clampTextToValueRange",
    "clampToValueRange",
    "currentLocalCollectionRows",
  ]);
  await grid.splitGridMultipleValueRows(
    { columnId: "prop:IC50", columnLabel: "IC50", delimiter: ";" },
    { documentId: "doc" },
  );
  assert.equal(state.undoStack.length, 0);
  assert.equal(state.dirty, false);
  assert.match(state.statuses.at(-1).message, /No row holds more than one value in IC50/);

  await grid.splitGridMultipleValueRows(
    { columnId: "descriptor:cLogP", columnLabel: "cLogP", delimiter: ";" },
    { documentId: "doc" },
  );
  assert.equal(state.statuses.at(-1).kind, "error", "a computed column is one value per row and cannot be split");
}

// --- Merge Equivalent Rows -------------------------------------------------
{
  const state = gridState();
  const grid = harness(state, ["mergeRowPropValues", "planEquivalentRowMerge"]);

  assert.deepEqual(
    grid.mergeRowPropValues([
      { props: { IC50: "5.2", Assay: "AZ", Note: "" } },
      { props: { IC50: "7.1", Assay: "AZ", Source: "Lit" } },
      { props: { IC50: "5.2" } },
    ], "; "),
    { IC50: "5.2; 7.1", Assay: "AZ", Source: "Lit" },
    "values that differ are kept side by side, equal ones once, and a column only one row has survives",
  );
  assert.deepEqual(grid.mergeRowPropValues([{ props: { IC50: "  " } }], "; "), {}, "a blank cell contributes nothing");

  const rows = [
    { index: 0, name: "A", smiles: "CC", molblock: "", props: { IC50: "5.2" } },
    { index: 1, name: "B", smiles: "CO", molblock: "", props: { IC50: "3" } },
    { index: 2, name: "A again", smiles: "CC", molblock: "", props: { IC50: "7.1" } },
  ];
  const plan = grid.planEquivalentRowMerge(rows, [{ keepIndex: 0, mergeIndexes: [2, 0, 99] }], "; ");
  assert.deepEqual(plan.hide, [2], "the row that stays is never folded into itself, and a row that is gone is skipped");
  assert.equal(plan.patches[0].row.props.IC50, "5.2; 7.1");
  assert.equal(plan.patches[0].row.smiles, "CC", "the row that stays keeps its structure");
  assert.deepEqual(rows[0].props, { IC50: "5.2" }, "planning must not touch the rows it read");

  assert.deepEqual(
    grid.planEquivalentRowMerge(rows, [{ keepIndex: 42, mergeIndexes: [2] }], "; "),
    { patches: [], hide: [] },
    "a group whose surviving row is gone changes nothing",
  );
}

// The merge over a paged collection: the row that stays keeps its id and takes
// the joined values, the equivalent rows are hidden the way a delete hides
// them, and one undo entry restores every row and every value.
{
  const loaded = [
    { index: 0, name: "A", smiles: "CC", molblock: "", props: { IC50: "5.2" } },
    { index: 1, name: "B", smiles: "CO", molblock: "", props: { IC50: "3" } },
    { index: 2, name: "A again", smiles: "CC", molblock: "", props: { IC50: "7.1" } },
  ];
  const state = gridState({
    remoteMode: true,
    rows: loaded.map((row) => ({ ...row })),
    selected: new Set([2]),
    totalRows: 3,
    recordsTotalHint: 3,
  });
  const grid = harness(state, [
    "mergeGridEquivalentRows",
    "mergeRowPropValues",
    "planEquivalentRowMerge",
    "applyVirtualGridEdits",
    "stripDeletedPropColumns",
    "applyColumnValueRanges",
    "clampTextToValueRange",
    "clampToValueRange",
  ]);

  await grid.mergeGridEquivalentRows(
    { groups: [{ keepIndex: 0, mergeIndexes: [2] }], separator: "; " },
    { documentId: "doc" },
  );

  assert.deepEqual(
    state.rows.map((row) => [row.index, row.props.IC50]),
    [[0, "5.2; 7.1"], [1, "3"]],
    "the merged row is gone from the window and the row that stays shows both values",
  );
  assert.deepEqual([...state.hiddenRows], [2]);
  assert.equal(state.selected.has(2), false, "a row that no longer exists cannot stay selected");
  assert.equal(state.totalRows, 2);
  assert.equal(state.recordsTotalHint, 2);
  assert.equal(state.dirty, true);
  assert.equal(state.undoStack.length, 1, "a merge is one undo entry, not one per row");

  assert.equal(grid.undo(), "Merge Equivalent Rows");
  assert.deepEqual(
    state.rows.map((row) => [row.index, row.props.IC50]),
    [[0, "5.2"], [1, "3"], [2, "7.1"]],
    "undo brings the merged row back with the value it had",
  );
  assert.equal(state.hiddenRows.size, 0);
  assert.equal(state.rowPatches.size, 0);
  assert.equal(state.totalRows, 3);
  assert.equal(state.dirty, false);
}

// Hover uses the whole molecule cell, including its padding. The same runtime
// must suppress the floating drawing while the host's right dock is open.
{
  const state = { rightDockOpen: false, tableMoleculePreview: null };
  const listeners = {};
  const previews = [];
  const picture = { addEventListener(type, handler) { listeners[type] = handler; } };
  const document = {
    createElement() {
      return { setAttribute() {}, remove() { this.removed = true; } };
    },
    body: { appendChild(node) { previews.push(node); } },
  };
  const install = new Function("state", "document", `
    const window = { addEventListener() {}, removeEventListener() {} };
    const rowHasMolecule = row => Boolean(row.smiles);
    const postChemicalSpaceHover = () => {};
    const draw = () => '<svg></svg>';
    const escapeHTML = value => value;
    const scheduleRdkitCard = () => {};
    const scheduleXyzrenderCard = () => {};
    const positionTableMoleculePreview = () => {};
    ${functionSource("hideTableMoleculePreview")}
    ${functionSource("showTableMoleculePreview")}
    ${functionSource("installTableMoleculeHover")}
    return installTableMoleculeHover;
  `)(state, document);
  install({ querySelector(selector) {
    return selector === 'td[data-column="molecule"]' ? picture : null;
  } }, { index: 0, name: "ethanol", smiles: "CCO" }, {});
  assert.equal(typeof listeners.pointerenter, "function");
  listeners.pointerenter({ pointerType: "mouse" });
  assert.match(previews[0].innerHTML, /<svg><\/svg>/);
  listeners.pointerleave();
  assert.equal(previews[0].removed, true);
  assert.equal(state.tableMoleculePreview, null);
  state.rightDockOpen = true;
  listeners.pointerenter({ pointerType: "mouse" });
  listeners.pointermove({ pointerType: "mouse" });
  assert.equal(previews.length, 1);
  state.rightDockOpen = false;
  listeners.pointermove({ pointerType: "mouse" });
  assert.equal(previews.length, 2);
  listeners.pointerleave();
  listeners.pointerenter({ pointerType: "touch" });
  assert.equal(state.tableMoleculePreview, null);
}

console.log("Grid table operation checks passed.");
