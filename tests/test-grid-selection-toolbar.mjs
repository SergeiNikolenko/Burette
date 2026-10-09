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
await new Promise(resolve => setTimeout(resolve, 0));
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
await new Promise(resolve => setTimeout(resolve, 0));
const sortMenu = document.querySelector('[data-buret-grid-select-menu]');
assert.deepEqual([...sortMenu.querySelectorAll('[role="menuitemradio"]')].map(item => [item.textContent, item.getAttribute('aria-checked'), item.getAttribute('aria-disabled')]),
  [['File order', 'true', null], ['Name', 'false', 'true']]);
assert.ok(sortMenu.querySelector('.atlas-select-check-slot svg'), 'checked option uses the shared leading indicator');
const beforeEscape = calls.length;
sortMenu.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
// FocusScope restores focus in a task after the portal unmounts.
await new Promise(resolve => setTimeout(resolve, 20));
assert.equal(document.querySelector('[data-buret-grid-select-menu]'), null);
assert.equal(document.activeElement?.id, 'sort', 'Escape returns focus to the original select');
assert.equal(calls.length, beforeEscape, 'dismissal must not change sorting');
button('sort').options[1].disabled = false;

// Browser surfaces replace the operating-system popup with an in-page menu.
// Picking from a select nested in the Actions menu must not dismiss it.
mount({ clusterEnabled: true, conformerVariant: 'ETKDGv3', mmffVariant: 'MMFF94', clusterCutoff: 0.6,
  onConformerVariantChange: value => calls.push(['conformer', value]) });
document.querySelector('.ab-actions-menu .ab-btn').click();
await new Promise(resolve => setTimeout(resolve, 0));
const conformer = document.querySelector('select[aria-label="Conformer generation method"]');
conformer.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
await new Promise(resolve => setTimeout(resolve, 0));
const choices = [...document.querySelectorAll('[data-buret-grid-select-menu] [role="menuitemradio"]')];
assert.deepEqual(choices.map(choice => [choice.textContent, choice.getAttribute('aria-checked')]),
  Array.from(conformer.options, option => [option.text, String(option.value === 'ETKDGv3')]));
const target = choices.find(choice => choice.getAttribute('aria-checked') === 'false');
target.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
target.click();
await new Promise(resolve => setTimeout(resolve, 0));
assert.deepEqual(calls.at(-1), ['conformer', target.textContent]);
assert.ok(document.querySelector('.ab-menu'), 'the Actions menu stays open while a nested choice is made');
assert.equal(document.querySelector('[data-buret-grid-select-menu]'), null);

for (const nativeConfig of [{ tauriViewer: true }, { quickLookViewer: true }, { host: 'app' }]) {
  window.BuretteConfig = nativeConfig;
  mount({});
  assert.equal(button('sort').closest('.buret-grid-select-anchor'), null, 'native surfaces retain their existing select route');
}
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
