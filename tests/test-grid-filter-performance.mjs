import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync('PreviewExtension/Web/grid-viewer.js', 'utf8');
function functionSource(name) {
  const match = new RegExp(`\\n  (?:async )?function ${name}\\(`).exec(source);
  assert.ok(match, `missing production function ${name}`);
  const rest = source.slice(match.index + 1);
  const end = rest.search(/\n {2}(?:async )?function [A-Za-z_$]/u);
  assert.ok(end > 0);
  return rest.slice(0, end);
}

// Execute the production cache and edit/undo paths, instrumenting only the
// numeric accessor and rendering boundary; no descriptor calculations run.
const state = {
  remoteMode: false, all: [{ index: 0, props: { score: 1 } }, { index: 1, props: { score: 5 } }],
  rows: [], totalRows: 2, rowPatches: new Map(), insertedRows: [],
  hiddenRows: new Set(), deletedPropColumns: new Set(), selected: new Set(),
  columnValueRanges: new Map(), filterColumnStatsCache: new Map(), filterColumnVariationCache: new Map(), filterColumnStatsRows: null,
  svgCache: new Map(), xyzrenderCardCache: new Map(), undoStack: [], redoStack: [], sourceRevision: 0,
  remoteDescriptorIds: [], tableColumnFilters: {},
  chemicalSpaceVisibilitySubscribers: new Set(), chemicalSpaceVisibilityGeneration: 0,
};
const testWindow = { clearTimeout() {} };
state.rows = state.all.slice();
const columns = [{ id: 'score', type: 'number' }, { id: 'derived', type: 'number' }];
const counts = { numericReads: 0, variationReads: 0, posts: 0 };
const names = [
  'filterColumnVaries', 'filterColumnIsRowIndex', 'filterColumnStats', 'gridFilterModel', 'postGridFilterModel', 'invalidateTableColumnCatalog',
  'tableColumnDiscoveryRows', 'currentLocalCollectionRows', 'applyVirtualGridEdits',
  'stripDeletedPropColumns', 'applyColumnValueRanges', 'replaceGridRow',
  'snapshotGridEditState', 'restoreGridEditState', 'applyDescriptorGridResults',
  'resetDocumentRuntimeState',
];
const stats = new Function('state', 'counts', 'columns', 'window', `
  const FILTER_BINS = 32;
  function filterModelColumns() { return columns; }
  function tableColumnNumericValue(row, id) {
    counts.numericReads++;
    return Number(id === 'derived' ? row.descriptors?.derived : row.props?.[id]);
  }
  function tableColumnRawNumericValue(row, id) { counts.variationReads++; return Number(row.props?.[id] ?? row.descriptors?.[id]); }
  function tableColumnRawDisplayValue(row, id) { counts.variationReads++; return String(row.props?.[id] ?? ''); }
  function post() { counts.posts++; }
  function capabilities() { return { editing: true }; }
  function pushUndoSnapshot() {}
  function markGridDirty() { state.sourceRevision++; }
  function render() {}
  function refresh() {}
  function refreshOpenMoleculeDetail() {}
  function normalizeDescriptorResultMap(value) { return value; }
  function setStatus() {}
  function notifyGridDirty() {}
  function syncGridEditControls() {}
  function cancelVirtualWindowRender() {}
  function resetRdkitCardObserver() {}
  function resetXyzrenderCardObserver() {}
  function resetCardRenderQueues() {}
  ${names.map(functionSource).join('\n')}
  return { postGridFilterModel, filterColumnStats, replaceGridRow, snapshotGridEditState,
    restoreGridEditState, applyDescriptorGridResults, invalidateTableColumnCatalog, resetDocumentRuntimeState };
`)(state, counts, columns, testWindow);

stats.postGridFilterModel({});
assert.equal(counts.numericReads, 4, 'first model scans two rows and two columns');
const initialVariationReads = counts.variationReads;
for (let index = 0; index < 20; index++) {
  state.selected = new Set([index % 2]);
  stats.postGridFilterModel({});
}
assert.equal(counts.numericReads, 4, 'selection/scroll model refreshes perform zero additional row reads');
assert.equal(counts.variationReads, initialVariationReads, 'variation and row-index checks also reuse cached results');
assert.equal(counts.posts, 1, 'unchanged model is sent only once');
const original = stats.snapshotGridEditState();
stats.replaceGridRow(state.rows[0], { props: { score: 9 } }, {}, { undo: false });
assert.equal(stats.filterColumnStats(columns[0]).max, 9, 'row edits invalidate stats');
stats.restoreGridEditState(original);
assert.equal(stats.filterColumnStats(columns[0]).max, 5, 'undo restores the distribution');
stats.applyDescriptorGridResults({ rows: [
  { index: 0, descriptors: { derived: 4 } }, { index: 1, descriptors: { derived: 8 } },
] }, {});
assert.equal(stats.filterColumnStats(columns[1]).max, 8, 'derived values invalidate a cached empty column');
testWindow.BuretteGridRecords = [{ index: 0, props: { score: 10 } }, { index: 1, props: { score: 20 } }];
stats.resetDocumentRuntimeState();
assert.equal(stats.filterColumnStats(columns[0]).min, 10, 'same-size document replacement drops old rows');
console.log('Histogram: 20 unchanged refreshes = 0 additional numeric reads (initial model: 4).');

const visibilityState = {
  token: 1, dataToken: 1, remoteMode: true, query: 'fixture', sort: 'name', rows: [], totalRows: 360,
  chemicalSpaceVisibilitySubscribers: new Set(), chemicalSpaceVisibilityRequest: null,
  chemicalSpaceVisibilityGeneration: 0, chemicalSpaceVisibilityScanning: false,
  lastChemicalSpaceVisibility: null,
};
const pageRows = Array.from({ length: 360 }, (_, index) => ({ index }));
visibilityState.rows = pageRows.slice(0, 120);
const calls = [];
const posts = [];
let heldResponse = null;
const visibilityNames = ['postChemicalSpaceVisibility', 'updateRemoteChemicalSpaceVisibility',
  'requestChemicalSpaceVisibility', 'collectRemoteChemicalSpaceVisibility', 'render'];
const visibility = new Function('state', 'hostRequest', 'posts', `
  const GRID_SELECTION_BRIDGE_LIMIT = 100000;
  function chemicalSpaceGridFiltersActive() { return Boolean(state.query); }
  function gridFetchPayload(payload) { return payload; }
  function loadBatchSize() { return 120; }
  function post(type, message, body) { posts.push({ type, body }); }
  const document = { getElementById() { return { innerHTML: '' }; } };
  const root = { querySelector() { return null; } };
  function cancelVirtualWindowRender() {}
  function resetRdkitCardObserver() {}
  function resetXyzrenderCardObserver() {}
  function resetCardRenderQueues() {}
  async function renderVirtualWindow() {}
  ${visibilityNames.map(functionSource).join('\n')}
  return { updateRemoteChemicalSpaceVisibility, requestChemicalSpaceVisibility, render };
`)(visibilityState, async (type, payload) => {
  calls.push(payload);
  if (heldResponse) return heldResponse;
  return { rows: pageRows.slice(payload.offset, payload.offset + payload.limit), totalRows: 360 };
}, posts);
const branchStart = source.indexOf("      if (body.type === 'chemicalSpaceVisibilitySubscription')");
const branchEnd = source.indexOf("      if (body.type === 'chemicalSpaceRequestRecords')", branchStart);
assert.ok(branchStart >= 0 && branchEnd > branchStart);
const subscription = new Function('state', 'body', 'requestChemicalSpaceVisibility', 'config', source.slice(branchStart, branchEnd));
const subscribe = (subscriberId, active) => subscription(visibilityState,
  { subscriberId, active, type: 'chemicalSpaceVisibilitySubscription' }, visibility.requestChemicalSpaceVisibility, () => ({}));
const drain = () => new Promise(resolve => setImmediate(resolve));
const firstPage = { rows: visibilityState.rows, totalRows: 360 };
visibility.updateRemoteChemicalSpaceVisibility(firstPage, {}, 1);
await drain();
assert.equal(calls.length, 0, 'search with no map must not fetch background pages');
await visibility.render({});
assert.equal(visibilityState.token, 2, 'Cards/Table redraw advances the rendering token');
assert.equal(visibilityState.dataToken, 1, 'redraw preserves the filtered data generation');
subscribe('right', true);
await drain();
assert.deepEqual(calls.map(call => [call.offset, call.sort]), [[120, 'name'], [240, 'name']], 'reuse first page and preserve ordering');
assert.deepEqual(posts.at(-1).body.sourceRecordIds, pageRows.map(row => row.index));
subscribe('bottom', true);
subscribe('right', false);
assert.equal(visibilityState.chemicalSpaceVisibilitySubscribers.size, 1);
assert.equal(calls.length, 2, 'second map uses completed visibility');
subscribe('bottom', false);

// Closing the last map cancels further pages, including an in-flight response.
visibilityState.dataToken++;
visibility.updateRemoteChemicalSpaceVisibility(firstPage, {}, visibilityState.dataToken);
let finishResponse;
heldResponse = new Promise(resolve => { finishResponse = resolve; });
subscribe('right', true);
assert.equal(calls.length, 3);
subscribe('right', false);
const publishedBeforeClose = posts.length;
finishResponse({ rows: pageRows.slice(120, 240), totalRows: 360 });
await drain();
assert.equal(calls.length, 3, 'no next page after unsubscribe');
assert.equal(posts.length, publishedBeforeClose, 'no stale publication after unsubscribe');
heldResponse = null;
subscribe('right', true);
await drain();
assert.equal(calls.length, 5, 'reopening resumes a complete query without duplicating first page');
assert.deepEqual(posts.at(-1).body.sourceRecordIds, pageRows.map(row => row.index));
heldResponse = new Promise(resolve => { finishResponse = resolve; });
visibilityState.dataToken++;
visibility.updateRemoteChemicalSpaceVisibility(firstPage, {}, visibilityState.dataToken);
const publishedBeforeQueryChange = posts.length;
visibilityState.dataToken++;
finishResponse({ rows: pageRows.slice(120, 240), totalRows: 360 });
await drain();
assert.equal(calls.length, 6, 'query-token cancellation stops further visibility requests');
assert.equal(posts.length, publishedBeforeQueryChange, 'old query never publishes visibility');
console.log('Visibility: closed map = 0 extra requests; open map = 2 remaining pages for 360 rows/page120.');

// Run the real host subscription effect with a fake iframe. Closed docks remain
// mounted, so visibility changes must unsubscribe without requiring unmount.
const panelSource = readFileSync('apps/desktop/src/components/chemical-space-panel.tsx', 'utf8');
const subscriberStart = panelSource.indexOf('    const subscriberId = crypto.randomUUID();');
const effectStart = panelSource.lastIndexOf('  useEffect(() => {', subscriberStart);
const effectEnd = panelSource.indexOf('\n  // Only one of the two', subscriberStart);
assert.ok(effectStart >= 0 && effectEnd > effectStart);
const effectJs = ts.transpileModule(panelSource.slice(effectStart, effectEnd), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const hostMessages = [];
const iframeWindow = { postMessage: message => hostMessages.push(message.body) };
const listeners = new Set();
let sourceUpdates = 0;
const hostWindow = { addEventListener: (_, listener) => listeners.add(listener), removeEventListener: (_, listener) => listeners.delete(listener) };
function mountHost(visible) {
  let cleanup;
  new Function('useEffect', 'documentId', 'documentInstanceKey', 'visible', 'crypto', 'window', 'activeViewerIframeForDocument', 'isKnownViewerMessageSource', 'applySourceRevision', effectJs)(
    effect => { cleanup = effect(); }, 'fixture', 'v1', visible, { randomUUID: () => 'panel' }, hostWindow,
    () => ({ contentWindow: iframeWindow }), source => source === iframeWindow, () => { sourceUpdates++; },
  );
  return cleanup;
}
const unmountHidden = mountHost(false);
assert.equal(hostMessages.filter(message => message.type === 'chemicalSpaceVisibilitySubscription').length, 0, 'hidden mounted panel never subscribes');
for (const listener of listeners) listener({ source: iframeWindow, data: { source: 'burette-grid', body: { type: 'gridDirtyChanged', documentId: 'fixture', sourceRevision: 1 } } });
assert.equal(sourceUpdates, 1, 'hidden panel still observes source revisions to invalidate stale embeddings');
unmountHidden();
hostMessages.length = 0;
const unmount = mountHost(true);
assert.equal(hostMessages[0].type, 'chemicalSpaceVisibilitySubscription');
assert.equal(hostMessages[0].active, true);
for (const listener of listeners) listener({ source: iframeWindow, data: { source: 'burette-grid', body: { type: 'ready', documentId: 'fixture' } } });
assert.equal(hostMessages.at(-1).active, true, 'iframe readiness rebinds subscription');
unmount();
assert.equal(hostMessages.at(-1).active, false, 'hide/unmount unsubscribes');
assert.equal(listeners.size, 0);
assert.match(readFileSync('apps/desktop/src/components/dock-panel.tsx', 'utf8'), /visible=\{area === "right" \? state\.rightDockOpen : state\.bottomDockOpen\}/);
console.log('Host subscription: hidden=0; visible subscribes; ready rebinds; hide cleans up.');
