import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

const window = new Window();
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
await import('../apps/desktop/src/preview-grid/grid-ui.tsx');
const host = document.createElement('div');
host.id = 'grid-controls';
document.body.append(host);
const calls = [];
const props = {
  selectionEnabled: true, ketcherOpen: true, molstarOpen: true,
  selectedCount: 0, selectableCount: 3, allVisibleSelected: false, ketcherPending: false,
  viewMode: 'cards', cardRenderer: 'rdkit', xyzrenderPresetOptions: [], sortOptions: [],
  onSelectAll: () => calls.push('all'), onClearSelection: () => calls.push('clear'),
  onOpenKetcher: () => calls.push('ketcher'), onRendererSwitch: mode => calls.push(mode),
};
const mount = patch => window.BuretteGridUI.mountGridControls(host, { ...props, ...patch });
const button = id => document.getElementById(id);
mount({});
assert.equal(button('selected-open-actions').hasAttribute('hidden'), false);
assert.deepEqual(['select-all', 'open-selected-ketcher', 'open-selected-molstar'].map(id => button(id).disabled), [false, true, true]);
button('select-all').click();
mount({ selectedCount: 3, allVisibleSelected: true });
assert.equal(document.querySelector('[role="status"]').textContent, '3 selected');
assert.deepEqual(['select-all', 'open-selected-ketcher', 'open-selected-molstar'].map(id => button(id).disabled), [true, false, false]);
button('open-selected-ketcher').click();
button('open-selected-molstar').click();
button('clear-selection').click();
assert.deepEqual(calls, ['all', 'ketcher', 'molstar', 'clear']);
mount({ selectedCount: 1, ketcherPending: true });
assert.deepEqual(['open-selected-ketcher', 'open-selected-molstar'].map(id => button(id).disabled), [true, false]);
mount({ selectedCount: 1 });
assert.equal(button('open-selected-ketcher').disabled, false, 'pending handoff must recover after a toolbar refresh');
mount({ selectableCount: 0 });
assert.equal(button('select-all').disabled, true);
assert.equal(button('selected-open-actions').hidden, false, 'empty selection keeps destinations discoverable');
assert.equal(button('clear-selection'), null);
mount({ ketcherOpen: false, molstarOpen: false });
assert.equal(button('selected-open-actions'), null, 'unsupported surfaces do not expose unavailable tools');

const source = readFileSync('PreviewExtension/Web/grid-viewer.js', 'utf8');
const start = source.indexOf('  function gridSelectionState()');
const end = source.indexOf('\n  function ', start + 1);
const state = { selected: new Set([1, 7]), ketcherOpenPendingUntil: 0 };
let visible = [1, 2];
const selection = new Function('state', 'selectableRowIndexes', source.slice(start, end) + '\nreturn gridSelectionState;')(state, () => visible);
assert.deepEqual(selection(), { selectedCount: 2, selectableCount: 2, allVisibleSelected: false, ketcherPending: false });
visible = [1, 7];
assert.equal(selection().allVisibleSelected, true, 'select-all state tracks the filtered rows, not just matching counts');
visible = [];
assert.equal(selection().allVisibleSelected, false);
await window.happyDOM.abort();

const insetStart = source.indexOf('  function applyGridToolbarInset()');
const insetEnd = source.indexOf('\n  function ', insetStart + 1);
const insetHost = { dataset: {}, style: {}, getBoundingClientRect: () => ({ left: 44 }) };
const insetState = { gridViewportCover: 105 };
const inset = new Function('state', 'document', source.slice(insetStart, insetEnd) + '\nreturn applyGridToolbarInset;')(insetState, { getElementById: () => insetHost, documentElement: { clientWidth: 420 } });
inset();
assert.ok(44 + parseFloat(insetHost.style.maxWidth) < 420 - 105, 'toolbar includes its left gutter and stays before the floating dock');
insetState.gridViewportCover = 0;
inset();
assert.equal(insetHost.style.maxWidth, '', 'full-width layout recovers when the dock stops covering the grid');
console.log('Grid selection controls: visible destinations, filtered selection, callbacks, pending recovery and capability gates passed');
