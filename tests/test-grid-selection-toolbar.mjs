import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

const window = new Window();
// The browser select menus are Radix; it needs the DOM classes and events of
// the same window.
for (const name of ['document', 'HTMLElement', 'Element', 'Node', 'DocumentFragment', 'ShadowRoot', 'ResizeObserver',
  'Event', 'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'FocusEvent']) globalThis[name] = window[name];
globalThis.window = window;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
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
// React portals and Radix focus restoration can span multiple tasks on CI.
async function waitFor(predicate, message) {
  const deadline = Date.now() + 2000;
  while (!predicate() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok(predicate(), message);
}
mount({});
assert.equal(button('selected-open-actions').hasAttribute('hidden'), false);
assert.deepEqual(['select-all', 'open-selected-ketcher', 'open-selected-molstar'].map(id => button(id).disabled), [false, true, true]);
button('open-selected-ketcher').click();
button('open-selected-molstar').click();
assert.deepEqual(calls, [], 'disabled shared buttons must not dispatch open actions');
assert.equal(button('open-selected-ketcher').getAttribute('aria-description'), 'Select molecules to edit in Ketcher');
// Hints are portaled outside the clipped toolbar and never activate an action.
button('select-all').focus();
await waitFor(() => document.querySelector('[role="tooltip"]'), 'selection hint opens');
const hint = document.querySelector('[role="tooltip"]');
assert.equal(hint?.textContent, 'Select all visible molecules');
assert.equal(host.contains(hint), false, 'the tooltip must escape toolbar clipping');
button('select-all').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
await waitFor(() => !document.querySelector('[role="tooltip"]'), 'selection hint closes');
assert.equal(document.querySelector('[role="tooltip"]'), null);
assert.equal(document.activeElement?.id, 'select-all', 'Escape preserves focus');
assert.deepEqual(calls, [], 'focus and dismissal must not select molecules');
button('select-all').click();
mount({ selectedCount: 3, allVisibleSelected: true });
assert.equal(document.querySelector('[role="status"]').textContent, '3 selected');
assert.deepEqual(['select-all', 'open-selected-ketcher', 'open-selected-molstar'].map(id => button(id).disabled), [true, false, false]);
assert.deepEqual(['open-selected-ketcher', 'open-selected-molstar'].map(id => [button(id).hasAttribute('data-disabled'), button(id).getAttribute('aria-disabled')]), [[false, null], [false, null]], 'selected molecules enable both native and Atlas button states');
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

mount({ substructureSearch: true, supportsXyzrenderCards: true,
  onSetCardRenderer: value => calls.push(['view', value]),
  onXyzrenderPresetChange: value => calls.push(['style', value]),
  onSortChange: value => calls.push(['sort', value]),
  xyzrenderPresetOptions: [{ value: 'skeletal', label: 'Skeletal' }],
  sortOptions: [{ value: 'index', label: 'File order' }, { value: 'name', label: 'Name' }],
});
assert.deepEqual(Array.from(button('card-renderer').options, option => [option.value, option.text]),
  [['rdkit', '2D diagrams'], ['xyzrender', '3D renders']]);
assert.equal(button('card-renderer').getAttribute('aria-label'), 'Molecule view');
assert.equal(button('sort').getAttribute('aria-label'), 'Sort molecules');
button('card-renderer').value = 'xyzrender';
button('card-renderer').dispatchEvent(new window.Event('change', { bubbles: true }));
button('sort').value = 'name';
button('sort').dispatchEvent(new window.Event('change', { bubbles: true }));
assert.deepEqual(calls.slice(-2), [['view', 'xyzrender'], ['sort', 'name']], 'user-facing names preserve renderer and sorting contracts');
assert.equal(button('search').getAttribute('autocomplete'), 'off');
const updateSearch = value => {
  calls.push(['search', value]);
  mount({ searchQuery: value, onSearchInput: updateSearch });
};
mount({ searchQuery: '', onSearchInput: updateSearch });
const searchField = button('search');
searchField.focus();
for (const query of ['C', 'CC', 'CCC']) {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(searchField, query);
  searchField.dispatchEvent(new window.Event('input', { bubbles: true }));
}
assert.deepEqual(calls.slice(-3), [['search', 'C'], ['search', 'CC'], ['search', 'CCC']], 'rapid input forwards every query without restoring stale props');
assert.equal(button('search'), searchField, 'toolbar updates retain the focused input');
const clearSearch = host.querySelector('button[aria-label="Clear search"]');
assert.ok(clearSearch, 'the shared search exposes its clear action once there is a query');
clearSearch.click();
assert.deepEqual(calls.at(-1), ['search', '']);
assert.equal(searchField.value, '');
assert.equal(document.activeElement, searchField, 'clearing preserves search focus');

// The standalone grid uses the same single-selection/keyboard primitive as
// the inspector while preserving the attributes consumed by grid-viewer.
mount({ onViewModeChange: mode => {
  calls.push(['mode', mode]);
  mount({ viewMode: mode });
} });
const tableMode = host.querySelector('[data-buret-grid-view-mode="table"]');
const cardsMode = host.querySelector('[data-buret-grid-view-mode="cards"]');
assert.equal(cardsMode.getAttribute('aria-checked'), 'true');
cardsMode.focus();
cardsMode.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
await waitFor(() => document.activeElement === tableMode, 'view-mode focus moves');
assert.equal(document.activeElement?.textContent, 'Table', 'arrow key reaches the adjacent mode');
tableMode.click();
assert.deepEqual(calls.at(-1), ['mode', 'table']);
assert.equal(tableMode.getAttribute('aria-checked'), 'true');
assert.equal(cardsMode.getAttribute('aria-checked'), 'false');

mount({ sortOptions: [{ value: 'index', label: 'File order' }, { value: 'name', label: 'Name' }],
  onSortChange: value => calls.push(['sort', value]) });

// The popup reads imperative runtime updates, not stale React select props.
button('sort').value = 'index';
button('sort').options[1].disabled = true;
button('sort').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
await waitFor(() => document.querySelector('[data-buret-grid-select-menu]'), 'sort menu opens');
const sortMenu = document.querySelector('[data-buret-grid-select-menu]');
assert.deepEqual([...sortMenu.querySelectorAll('[role="menuitemradio"]')].map(item => [item.textContent, item.getAttribute('aria-checked'), item.getAttribute('aria-disabled')]),
  [['File order', 'true', null], ['Name', 'false', 'true']]);
assert.ok(sortMenu.querySelector('.atlas-select-check-slot svg'), 'checked option uses the shared leading indicator');
const beforeEscape = calls.length;
sortMenu.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
// FocusScope restores focus in a task after the portal unmounts.
await waitFor(() => !document.querySelector('[data-buret-grid-select-menu]') && document.activeElement === button('sort'), 'sort menu closes and restores focus');
assert.equal(document.querySelector('[data-buret-grid-select-menu]'), null);
assert.equal(document.activeElement?.id, 'sort', 'Escape returns focus to the original select');
assert.equal(calls.length, beforeEscape, 'dismissal must not change sorting');
button('sort').options[1].disabled = false;

// Browser surfaces replace the operating-system popup with an in-page menu.
// Picking from a select nested in the Actions menu must not dismiss it.
mount({ clusterEnabled: true, conformerVariant: 'ETKDGv3', mmffVariant: 'MMFF94', clusterCutoff: 0.6,
  onConformerVariantChange: value => calls.push(['conformer', value]) });
const actionsTrigger = document.querySelector('.ab-actions-menu .ab-btn');
for (const enabled of [false, true]) {
  mount({ exportEnabled: true, saveEnabled: enabled, undoEnabled: enabled, saveAsEnabled: true, exportScopeLabel: '2 selected rows' });
  actionsTrigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  await waitFor(() => button('save-grid'), 'Actions menu opens');
  assert.deepEqual(['save-grid', 'undo-grid-edit', 'save-grid-as'].map(id => button(id).disabled), [!enabled, !enabled, false]);
  assert.equal(button('export-csv').title, 'Export 2 selected rows as CSV');
  document.querySelector('.ab-menu').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await waitFor(() => !document.querySelector('.ab-menu') && document.activeElement === actionsTrigger, 'Actions menu closes and restores focus');
}
mount({ clusterEnabled: true, conformerVariant: 'ETKDGv3', mmffVariant: 'MMFF94', clusterCutoff: 0.6,
  onConformerVariantChange: value => calls.push(['conformer', value]) });
actionsTrigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
await waitFor(() => document.querySelector('select[aria-label="Conformer generation method"]'), 'conformer controls appear');
const conformer = document.querySelector('select[aria-label="Conformer generation method"]');
conformer.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
await waitFor(() => document.querySelector('[data-buret-grid-select-menu] [role="menuitemradio"]'), 'conformer choices open');
const choices = [...document.querySelectorAll('[data-buret-grid-select-menu] [role="menuitemradio"]')];
assert.deepEqual(choices.map(choice => [choice.textContent, choice.getAttribute('aria-checked')]),
  Array.from(conformer.options, option => [option.text, String(option.value === 'ETKDGv3')]));
const target = choices.find(choice => choice.getAttribute('aria-checked') === 'false');
target.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
target.click();
await waitFor(() => !document.querySelector('[data-buret-grid-select-menu]'), 'nested choice closes');
assert.deepEqual(calls.at(-1), ['conformer', target.textContent]);
assert.ok(document.querySelector('.ab-menu'), 'the Actions menu stays open while a nested choice is made');
assert.equal(document.querySelector('[data-buret-grid-select-menu]'), null);
document.querySelector('.ab-menu').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
await waitFor(() => !document.querySelector('.ab-menu') && document.activeElement === actionsTrigger, 'Actions menu closes and restores focus');
assert.equal(document.querySelector('.ab-menu'), null);
assert.equal(document.activeElement, actionsTrigger, 'Escape restores the Actions trigger');

mount({ selectedCount: 2, exportEnabled: true, saveAsEnabled: true,
  onCopySelected: () => {
    assert.equal(document.querySelector('.ab-menu'), null, 'close the menu before dispatching a command');
    calls.push('copy');
  } });
actionsTrigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
await waitFor(() => document.activeElement === button('save-grid-as'), 'first enabled action receives focus');
assert.equal(document.activeElement?.id, 'save-grid-as', 'keyboard opening skips disabled Save and Undo');
assert.equal(host.contains(document.querySelector('.ab-menu')), false, 'Actions must escape toolbar clipping');
document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
await waitFor(() => document.activeElement?.textContent.trim() === 'Copy selected', 'End reaches the last action');
assert.equal(document.activeElement?.textContent.trim(), 'Copy selected');
document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
await waitFor(() => !document.querySelector('.ab-menu') && document.activeElement === actionsTrigger, 'command restores focus');
assert.equal(calls.at(-1), 'copy');
assert.equal(document.activeElement, actionsTrigger);

for (const nativeConfig of [{ tauriViewer: true }, { quickLookViewer: true }, { host: 'app' }]) {
  window.BuretteConfig = nativeConfig;
  mount({});
  assert.equal(button('sort').closest('.buret-grid-select-anchor'), null, 'native surfaces retain their existing select route');
}
delete window.BuretteConfig;

// The shared Radix items still expose the same native command model, including
// disabled flags and method pickers. No native popup is opened by this test.
window.BuretteConfig = { tauriViewer: true };
mount({ selectedCount: 2, clusterEnabled: true, selectedInput3d: true,
  conformerVariant: 'ETKDGv3', mmffVariant: 'MMFF94', clusterCutoff: 0.6,
  onCopySelected: () => calls.push('native-copy') });
actionsTrigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
await new Promise(resolve => setTimeout(resolve, 20));
new Function('window', 'document', 'Event', 'XMLSerializer', 'crypto', readFileSync('PreviewExtension/Web/native-viewer-menus.js', 'utf8'))(window, document, window.Event, window.XMLSerializer, crypto);
const nativeMenu = window.BuretteNativeViewerMenus.create(document.querySelector('.ab-menu'), { close() {} });
assert.deepEqual(nativeMenu.items.filter(item => item.kind === 'select').map(({ label, value }) => [label, value]),
  [['Conformer generation method', 'ETKDGv3'], ['MMFF optimization variant', 'MMFF94'], ['Tanimoto similarity cutoff', '0.60']]);
const nativeCopy = nativeMenu.items.find(item => item.text === 'Copy selected');
assert.equal(nativeCopy.disabled, false);
nativeMenu.handlers.get(nativeCopy.id)();
nativeMenu.close();
assert.equal(calls.at(-1), 'native-copy');
delete window.BuretteConfig;

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
