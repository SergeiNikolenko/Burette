import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const source = readFileSync("PreviewExtension/Web/grid-viewer.js", "utf8");
const ui = readFileSync("apps/desktop/src/preview-grid/grid-ui.tsx", "utf8");
function declaration(name) {
  const start = source.search(new RegExp(`  (?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  const next = source.slice(start + 1).search(/\n  (?:async )?function /);
  return source.slice(start, next < 0 ? undefined : start + 1 + next);
}

const state = {
  query: "", searchMode: "text", searchTimer: 0, searchTextCache: new WeakMap(), token: 0, dataToken: 0,
  sourceRevision: 0, smarts: "", smartsError: "", smartsMatches: new Map(),
  remoteMode: false, rows: [], selected: new Set(), all: [
    { index: 0, name: "CC label", smiles: "O", props: {} },
    { index: 1, name: "other", smiles: "CCC", props: { assay: "active" } },
  ],
};
let nextTimer = 0;
const timers = new Map();
let renders = 0;
const identity = (value) => value;
const searchNames = ["queryLooksLikeExplicitSMARTS", "queryLooksLikeSMILESFragment", "queryLooksLikeSMARTS", "shouldFallbackSMARTSToTextSearch", "setUnifiedSearchQuery", "scheduleSearch", "normalizedSearchText", "refresh", "normalize", "filterBySMARTS"];
const search = new Function("state", "capabilities", "setTimeout", "clearTimeout", "refreshGridControls", "resetGridWindowForNewResultSet", "currentLocalCollectionRows", "filterByChemicalSpaceSelection", "filterByTableColumnControls", "filterByDescriptorControls", "compareWithDescriptorSort", "render", "postChemicalSpaceVisibility", "substructureMatch",
  searchNames.map(declaration).join("\n") + "\nreturn { scheduleSearch, setUnifiedSearchQuery, refresh, normalizedSearchText, filterBySMARTS };"
)(state, () => ({ substructureSearch: true }), (fn) => { timers.set(++nextTimer, fn); return nextTimer; }, id => timers.delete(id), () => {}, () => {}, () => state.all, identity, identity, identity, () => 0, () => { renders++; }, () => {}, (row) => row.smiles.includes("CC") ? { atoms: [0, 1], bonds: [] } : null);

search.scheduleSearch("C", {});
search.scheduleSearch("CC", {});
search.scheduleSearch("CC label", {});
assert.equal(timers.size, 1);
assert.equal(state.token, 3, "each input invalidates obsolete remote work immediately");
assert.equal(renders, 0);
[...timers.values()][0]();
assert.deepEqual(state.rows.map(row => row.index), [0]);
assert.equal(renders, 1, "rapid typing renders only the final query");
const cached = state.searchTextCache.get(state.all[0]);
search.normalizedSearchText(state.all[0]);
assert.equal(state.searchTextCache.get(state.all[0]), cached, "unchanged row reuses normalized text");
state.all[0].name = "edited";
state.all[0].props.result = "changed";
state.sourceRevision++;
search.refresh({});
assert.deepEqual(state.rows, [], "edits invalidate cached search text");
assert.match(search.normalizedSearchText(state.all[0]), /changed/);
search.setUnifiedSearchQuery("CC", {}, "text");
assert.equal(state.smarts, "", "SMILES-looking text remains text in the UI's default mode");
search.setUnifiedSearchQuery("CC", {});
assert.equal(state.smarts, "CC", "legacy automatic interpretation remains available");
state.searchMode = "structure";
search.setUnifiedSearchQuery("CC", {}, "structure");
state.rdkit = { get_qmol: () => ({ is_valid: () => true, delete() {} }) };
assert.deepEqual(search.filterBySMARTS(state.all).map(row => row.index), [1]);
state.rdkit = { get_qmol: () => ({ is_valid: () => false, delete() {} }) };
assert.deepEqual(search.filterBySMARTS(state.all), [], "invalid explicit structure query cannot display all rows");

let completePage;
let appliedPages = 0;
state.rdkit = { get_qmol: () => ({ is_valid: () => true, delete() {} }) };
const scan = new Function("state", "loadBatchSize", "hostRequest", "gridFetchPayload", "hydrateDataWarriorRows", "applyGridPageState", "substructureMatch", "setStatus",
  declaration("scanRemoteBySMARTS") + "\nreturn scanRemoteBySMARTS;"
)(state, () => 120, () => new Promise(resolve => { completePage = resolve; }), identity, async rows => rows, () => { appliedPages++; }, () => ({ atoms: [0] }), () => {});
const obsolete = scan({}, state.dataToken);
state.dataToken++;
completePage({ rows: state.all, totalRows: 2 });
assert.deepEqual(await obsolete, []);
assert.equal(appliedPages, 0, "obsolete SMARTS pages cannot mutate current result/index state");

let pages = [];
const exports = new Function("state", "chemicalSpaceGridFiltersActive", "requireCollectionIndexReady", "currentLocalCollectionRows", "collectAllRemoteRows", "materializeRemoteCollectionRows", "loadBatchSize", "hostRequest", "applyVirtualGridEdits", "hydrateDataWarriorRows", "setStatus",
  declaration("exportScopeLabel") + declaration("collectExportRows") + "\nreturn { exportScopeLabel, collectExportRows };"
)(state, () => Boolean(state.query), () => true, () => state.all, async () => state.all, identity, () => 120, async (_, page) => { pages.push(page); return { rows: state.all.slice(page.offset, page.offset + 1), totalRows: state.all.length }; }, identity, async rows => rows, () => {});
state.searchTimer = 0; state.smarts = ""; state.query = ""; state.rows = state.all;
assert.equal(exports.exportScopeLabel(), "2 all rows");
state.query = "edited"; state.rows = [state.all[0]];
assert.equal(exports.exportScopeLabel(), "1 filtered row");
assert.deepEqual(await exports.collectExportRows({}), [state.all[0]]);
state.selected = new Set([1]);
assert.equal(exports.exportScopeLabel(), "1 selected row");
assert.deepEqual(await exports.collectExportRows({}), [state.all[1]], "local selection wins over the filter");
state.remoteMode = true; state.totalRows = 1;
assert.deepEqual(await exports.collectExportRows({}), [state.all[1]], "selected row beyond remote loaded window is fetched");
assert.deepEqual(pages.map(page => ({ query: page.query, offset: page.offset })), [{ query: "", offset: 0 }, { query: "", offset: 1 }]);
state.selected.clear(); state.totalRows = 2;
assert.deepEqual(await exports.collectExportRows({}), state.all, "unselected remote export collects the full filtered view");

const sectionStart = ui.indexOf("function FileSection(");
const sectionEnd = ui.indexOf("\n// Shared", sectionStart);
const compiled = new Bun.Transpiler({ loader: "tsx", tsconfig: JSON.stringify({ compilerOptions: { jsx: "react" } }) }).transformSync(ui.slice(sectionStart, sectionEnd));
const FileSection = new Function("React", compiled + "\nreturn FileSection;")(React);
for (const enabled of [false, true]) {
  const html = renderToStaticMarkup(React.createElement(FileSection, {
    exportEnabled: true, saveEnabled: enabled, undoEnabled: enabled, saveAsEnabled: true,
    exportScopeLabel: "2 selected rows", exportPending: false, onRun() {},
  }));
  assert.match(html, /id="save-grid"/);
  assert.match(html, /id="undo-grid-edit"/);
  assert.equal(/id="save-grid"[^>]*disabled/.test(html), !enabled);
  assert.equal(/id="undo-grid-edit"[^>]*disabled/.test(html), !enabled);
  assert.match(html, /Export 2 selected rows as CSV/);
}
assert.ok(ui.indexOf("<FileSection {...props}") < ui.indexOf("<ComputeSection {...props}"), "File actions come first");
assert.match(ui, /<ToggleGroupItem value="text"/);
assert.match(ui, /<ToggleGroupItem value="structure"/);
console.log("Grid search, export scope and stable file actions passed.");
