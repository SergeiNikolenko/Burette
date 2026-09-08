import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('PreviewExtension/Web/grid-viewer.js', 'utf8');
const start = source.indexOf('  async function revealChemicalSpaceRow(');
const end = source.indexOf('  function scrollToGridRow(', start);
assert.ok(start >= 0 && end > start);
const implementation = source.slice(start, end);

function setup({ remoteMode = false, rows = [{ index: 91 }, { index: 4 }], pages = [], totalRows = rows.length, request } = {}) {
  const state = { dataToken: 1, remoteLoadToken: 0, remoteMode, rows, totalRows, query: 'active', sort: 'prop:MW' };
  const calls = [], revealed = [], messages = [];
  const env = {
    state,
    hostRequest: async (type, payload) => {
      calls.push({ type, ...payload });
      return request ? request() : { rows: pages.shift() ?? [], totalRows };
    },
    gridFetchPayload: value => ({ ...value, tableColumnFilters: [{ id: 'active', text: '1' }] }),
    loadBatchSize: () => 120,
    hydrateDataWarriorRows: async value => value,
    applyVirtualGridEdits: value => value,
    applyGridPageState: result => { state.totalRows = result.totalRows; },
    invalidateTableColumnCatalog() {}, syncGridEditControls() {},
    scrollToGridRow: index => revealed.push(index),
    setStatus: message => messages.push(message),
  };
  const reveal = new Function(...Object.keys(env), `${implementation}; return revealChemicalSpaceRow;`)(...Object.values(env));
  return { state, calls, revealed, messages, reveal: index => reveal(index, {}, state.dataToken) };
}

const local = setup();
await local.reveal(4);
assert.deepEqual(local.revealed, [4], 'resolve source identity rather than sorted position');
assert.deepEqual(local.calls, []);

const remote = setup({ remoteMode: true, rows: [{ index: 91 }], pages: [[{ index: 73 }], [{ index: 4 }]], totalRows: 3 });
await remote.reveal(4);
assert.deepEqual(remote.revealed, [4]);
assert.deepEqual(remote.calls.map(call => [call.type, call.offset, call.query, call.sort, call.tableColumnFilters]), [
  ['gridFetchPage', 1, 'active', 'prop:MW', [{ id: 'active', text: '1' }]],
  ['gridFetchPage', 2, 'active', 'prop:MW', [{ id: 'active', text: '1' }]],
]);
assert.equal(remote.state.remoteLoading, false);

const filtered = setup();
await filtered.reveal(800);
assert.deepEqual(filtered.revealed, []);
assert.equal(filtered.messages.length, 1, 'do not silently reveal an unrelated row when filtered out');

let resolvePage;
const stale = setup({ remoteMode: true, rows: [], totalRows: 1, request: () => new Promise(resolve => { resolvePage = resolve; }) });
const pending = stale.reveal(4);
stale.state.dataToken += 1;
resolvePage({ rows: [{ index: 4 }], totalRows: 1 });
await pending;
assert.deepEqual(stale.revealed, [], 'a later query or map click cancels old navigation');
assert.deepEqual(stale.state.rows, []);
console.log('Chemical Space grid navigation checks passed');

// Exercise the actual message branch: navigation waits for the refreshed rows,
// and lasso/legacy selection messages do not acquire implicit focus behavior.
const branchStart = source.indexOf("      if (body.type === 'chemicalSpaceSelectionChanged') {");
const branchEnd = source.indexOf("      if (body.type === 'chemicalSpaceRequestState')", branchStart);
const messageBranch = source.slice(branchStart, branchEnd);
for (const focusSourceRecordId of [4, null, undefined, 90]) {
  const state = { dataToken: 0 };
  const focused = [];
  let completeRefresh;
  const env = {
    state, GRID_SELECTION_BRIDGE_LIMIT: 10_000, config: () => ({}),
    refresh: () => { state.dataToken++; return new Promise(resolve => { completeRefresh = resolve; }); },
    revealChemicalSpaceRow: (index, cfg, token) => focused.push([index, token]),
  };
  const receive = new Function(...Object.keys(env), 'body', messageBranch);
  receive(...Object.values(env), { type: 'chemicalSpaceSelectionChanged', sourceRecordIds: [91, 4], focusSourceRecordId });
  assert.deepEqual([...state.selected], [91, 4]);
  assert.deepEqual(focused, []);
  completeRefresh();
  await Promise.resolve();
  assert.deepEqual(focused, focusSourceRecordId === 4 ? [[4, 1]] : []);
}
console.log('Chemical Space selection bridge checks passed');
