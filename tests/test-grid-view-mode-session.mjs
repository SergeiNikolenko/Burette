import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript-compiler-api';

const hookSource = fs.readFileSync('apps/desktop/src/hooks/use-grid-view-mode-session.ts', 'utf8');
const js = ts.transpileModule(hookSource.replace(/^import .*;$/gm, '').replace('export function', 'function'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const listeners = new Set();
const effects = [];
const sent = [];
const frame = { contentWindow: { postMessage: message => sent.push(message) } };
let store = { tabs: [
  { id: 'a', location: { kind: 'file', path: '/a.csv', gridViewMode: 'table' }, back: ['keep-history'] },
  { id: 'b', location: { kind: 'file', path: '/b.csv', gridViewMode: 'cards' } },
], navigateTabLocation(id, location, mode) {
  assert.equal(mode, 'replace');
  store.tabs = store.tabs.map(tab => tab.id === id ? { ...tab, location } : tab);
} };
const hook = new Function('useCallback', 'useEffect', 'useMoleculeStore', 'window', `${js}; return useGridViewModeSession;`)(
  fn => fn, effect => effects.push(effect()), { getState: () => store }, {
    addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn),
  },
);
const restore = hook('a', '/a.csv', true, { current: frame });
const receive = (type, value, source = frame.contentWindow) => {
  for (const listener of listeners) listener({ source, data: { source: 'burette-grid', body: { type, value } } });
};
restore(frame, false);
assert.equal(sent.length, 0, 'staging frames do not restore or persist');
receive('gridViewModeReady');
assert.deepEqual(sent.pop().body, { type: 'gridRestoreViewMode', value: 'table' });
receive('gridViewModeChanged', 'cards', {});
assert.equal(store.tabs[0].location.gridViewMode, 'table', 'foreign frame rejected');
receive('gridViewModeChanged', 'invalid');
assert.equal(store.tabs[0].location.gridViewMode, 'table', 'invalid value rejected');
receive('gridViewModeChanged', 'cards');
assert.equal(store.tabs[0].location.gridViewMode, 'cards');
assert.deepEqual(store.tabs[0].back, ['keep-history']);
receive('gridViewModeChanged', 'table');
assert.equal(store.tabs[1].location.gridViewMode, 'cards', 'other tab retains its own choice');
const page = fs.readFileSync('apps/desktop/src/components/editor-area/page-kinds/file.tsx', 'utf8');
const codecLines = page.split('\n').filter(line => /^  (fromPayload|serialize):/.test(line)).join('\n');
const codec = new Function(`return { ${codecLines} };`)();
store.tabs = store.tabs.map(tab => ({ ...tab, location: codec.fromPayload(JSON.parse(JSON.stringify(codec.serialize(tab.location)))) }));
assert.equal(codec.fromPayload({ path: '/a.csv', gridViewMode: 'invalid' }).gridViewMode, undefined);
assert.equal(codec.fromPayload({ path: '/a.csv' }).gridViewMode, undefined, 'old sessions retain app default');
restore(frame, true);
assert.equal(sent.pop().body.value, 'table', 'serialized session restores chosen mode');
store.tabs[0].location = { kind: 'file', path: '/new.csv' };
receive('gridViewModeChanged', 'table');
assert.equal(store.tabs[0].location.gridViewMode, undefined, 'late message cannot change a new location');
for (const cleanup of effects) cleanup?.();
assert.equal(listeners.size, 0);

// The opaque-origin viewer restores only once per runtime. A second load/ready
// delivery must not undo a newer user choice; only its parent may initialize it.
const grid = fs.readFileSync('PreviewExtension/Web/grid-viewer.js', 'utf8');
const block = grid.slice(grid.indexOf("      if (body.type === 'gridRestoreViewMode')"), grid.indexOf("      if (body.type === 'gridWindowCapture'"));
const state = { viewMode: 'cards' }, parent = {};
let molecular = true;
const apply = new Function('state', 'window', 'setGridViewMode', 'config', 'notifyGridMenuState', 'effectiveMolecularGrid', `return (body, event) => { ${block} };`)(
  state, { parent }, value => { state.viewMode = value; }, () => ({}), () => {}, () => molecular,
);
apply({ type: 'gridRestoreViewMode', value: 'table' }, { source: {} });
assert.equal(state.viewMode, 'cards');
apply({ type: 'gridRestoreViewMode', value: 'table' }, { source: parent });
assert.equal(state.viewMode, 'table');
state.viewMode = 'cards';
apply({ type: 'gridRestoreViewMode', value: 'table' }, { source: parent });
assert.equal(state.viewMode, 'cards');
state.hostViewModeSession = false;
molecular = false;
apply({ type: 'gridRestoreViewMode', value: 'cards' }, { source: parent });
assert.equal(state.viewMode, 'table', 'changed non-molecular file retains its required table view');
console.log('Grid view session: restart, tab isolation, history, stale messages and idempotent restore passed.');

// Exercise the real session reopen path: document IDs change on relaunch.
// addDocuments must not replace serialized view metadata with a bare location.
const { Window } = await import("happy-dom");
globalThis.window = new Window({ url: "http://localhost/" });
globalThis.localStorage = globalThis.window.localStorage;
globalThis.document = globalThis.window.document;
globalThis.navigator = globalThis.window.navigator;
const { useMoleculeStore } = await import('../apps/desktop/src/stores/molecule-store.ts');
const recovered = codec.fromPayload({ path: '/a.csv', documentId: 'old-runtime', gridViewMode: 'table' });
useMoleculeStore.setState({ documents: [], tabs: [{ id: 'restored', location: recovered, back: [], forward: [] }], activeTabId: 'restored' });
useMoleculeStore.getState().addDocuments([{ id: 'new-runtime', path: '/a.csv', title: 'a.csv', renderer: 'grid2d' }]);
assert.equal(useMoleculeStore.getState().tabs[0].location.gridViewMode, 'table', 'reopening a persisted tab preserves its view metadata');
assert.equal(useMoleculeStore.getState().tabs[0].location.documentId, 'new-runtime');
useMoleculeStore.getState().replaceDocument('new-runtime', { id: 'saved-runtime', path: '/saved.csv', title: 'saved.csv', renderer: 'grid2d' });
assert.equal(useMoleculeStore.getState().tabs[0].location.gridViewMode, 'table', 'Save As retains the tab choice');
console.log('Production store: reopen and document replacement retain grid view mode.');
