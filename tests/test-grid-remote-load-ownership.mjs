import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const path = "PreviewExtension/Web/grid-viewer.js";
const source = process.argv[2] ? execFileSync("git", ["show", `${process.argv[2]}:${path}`], { encoding: "utf8" }) : readFileSync(path, "utf8");
function declaration(name) {
  const start = source.search(new RegExp(`  (?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  const next = source.slice(start + 1).search(/\n  (?:async )?function /);
  return source.slice(start, next < 0 ? undefined : start + 1 + next);
}
const state = {
  token: 0, dataToken: 0, remoteLoadToken: 0, remoteMode: true, remoteLoading: false,
  searchTimer: 0, rows: [], query: "", sort: "index", smarts: "", chemicalSpaceVisibilityGeneration: 0,
  selected: new Set([1]), totalRows: 2, visibleCount: 0, rendering: false,
};
const pending = [];
let controlSyncs = 0;
const noop = () => {};
const env = {
  state, document: { getElementById: () => ({ innerHTML: "" }) }, root: { querySelector: () => null },
  cancelVirtualWindowRender: noop, resetRdkitCardObserver: noop, resetXyzrenderCardObserver: noop,
  resetCardRenderQueues: noop, updateChrome: noop, postGridReady: noop,
  invalidateTableColumnCatalog: noop, loadBatchSize: () => 120, hasMoreRows: () => true,
  gridFetchPayload: value => value, hostRequest: () => new Promise(resolve => pending.push(resolve)),
  applyVirtualGridEdits: rows => rows, hydrateDataWarriorRows: async rows => rows,
  applyGridPageState: result => { state.totalRows = result.totalRows; },
  renderVirtualWindow: async (_, token) => assert.equal(token, state.token, "data completion renders the current view"),
  scheduleIndexPoll: noop, updateRemoteChemicalSpaceVisibility: noop, setStatus: noop,
  syncGridEditControls: () => { controlSyncs++; }, scrollToEstimatedGridRow: noop, scrollToGridPosition: noop,
};
const names = ["render", "refreshRemote", "refreshRemoteChemicalSpaceSelection", "loadMoreRemote", "loadRemoteRowsThrough"];
const api = new Function("env", `const { ${Object.keys(env).join(",")} } = env;\n${names.map(declaration).join("\n")}\nreturn { ${names.join(",")} };`)(env);

for (const name of ["refreshRemote", "refreshRemoteChemicalSpaceSelection", "loadMoreRemote", "loadRemoteRowsThrough"]) {
  state.rows = name.startsWith("refresh") ? [] : [{ index: 0 }];
  state.visibleCount = state.rows.length;
  state.totalRows = 2;
  const operation = name === "loadRemoteRowsThrough" ? api[name](1, {}) : api[name]({});
  assert.equal(state.remoteLoading, true, name);
  const dataToken = state.dataToken;
  await api.render({}); // Cards/Table and renderer changes use this exact path.
  assert.equal(state.dataToken, dataToken, "view-only render keeps pending data valid");
  pending.shift()({ rows: [{ index: 1 }], totalRows: 2 });
  await operation;
  assert.equal(state.remoteLoading, false, `${name} must release loading after a view switch`);
  assert.ok(state.rows.some(row => row.index === 1), `${name} must retain valid data after a view switch`);
}

const older = api.refreshRemote({});
const newer = api.refreshRemote({});
pending.shift()({ rows: [{ index: 7 }], totalRows: 1 });
await older;
assert.equal(state.remoteLoading, true, "older request cannot release a newer request's loading state");
assert.deepEqual(state.rows, []);
pending.shift()({ rows: [{ index: 8 }], totalRows: 1 });
await newer;
assert.equal(state.remoteLoading, false);
assert.deepEqual(state.rows, [{ index: 8 }]);

const cancelled = api.refreshRemote({});
state.dataToken++; // Search changes before the next debounced fetch starts.
pending.shift()({ rows: [{ index: 9 }], totalRows: 1 });
await cancelled;
assert.equal(state.remoteLoading, false, "cancelled owner still releases its own loading state");
assert.deepEqual(state.rows, []);
assert.ok(controlSyncs >= 6, "completion restores export controls");
console.log("Grid remote requests survive view rendering and preserve loading ownership.");
