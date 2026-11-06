import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import ts from 'typescript-compiler-api';

const source = readFileSync('PreviewExtension/Web/grid-viewer.js', 'utf8');
const ast = ts.createSourceFile('grid-viewer.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functions = new Map();
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);
const dom = new JSDOM('<div id="app"><div data-buret-grid-rail><div data-buret-grid-rail-ticks></div></div><div id="grid"></div></div>');
const { window } = dom;
const { document } = window;
const root = document.getElementById('app');
const grid = document.getElementById('grid');
const ticks = root.querySelector('[data-buret-grid-rail-ticks]');
Object.defineProperty(document.documentElement, 'scrollHeight', { value: 100000 });
let indexReads = 0;
const rows = Array.from({ length: 5000 }, (_, index) => ({
  get index() { indexReads++; return index; }, name: `Molecule ${index}`,
}));
const state = { rows, remoteMode: false, railHoveredMarker: null, token: 1,
  windowStart: 0, windowEnd: 5, rendering: false, virtualFrame: 0 };
let lensUpdates = 0;
let chromeUpdates = 0;
let rangeReads = 0;
const frames = [];
window.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
const names = ['updateGridRail', 'gridRailRows', 'gridRailTotalRows', 'updateGridRailActive',
  'updateGridRailCurrentMarker', 'handleGridScroll', 'scheduleVirtualWindowRender', 'renderVirtualWindow'];
const declarations = source.slice(source.indexOf('  const gridRailMarkup ='), source.indexOf('  function updateGridRail()'));
const runtime = new Function('state', 'window', 'document', 'root', 'metrics', `
  const GRID_RAIL_ITEM_SIZE = 10;
  ${declarations}
  function hasMoreRows() { return false; }
  function viewportHeight() { return window.innerHeight; }
  function cardViewRows(rows) { return rows; }
  function escapeAttr(value) { return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;'); }
  function updateGridRailLens() { metrics.lens(); }
  function updateChrome() { metrics.chrome(); }
  function updateGridToolbarCondensed() {}
  function maybeLoadMore() {}
  function updateTableHeaderStick() {}
  function nowMs() { return 0; }
  function virtualWindowRange() { metrics.range(); return { start: 0, end: 5 }; }
  ${names.map(name => functions.get(name)).join('\n')}
  return { updateGridRail, updateGridRailCurrentMarker, handleGridScroll };
`)(state, window, document, root, {
  lens: () => { lensUpdates++; }, chrome: () => { chromeUpdates++; }, range: () => { rangeReads++; },
});

runtime.updateGridRail();
const originalMarker = ticks.children[0];
originalMarker.focus();
const observer = new window.MutationObserver(() => {});
observer.observe(ticks, { childList: true, subtree: true, attributes: true });
for (let index = 0; index < 20; index++) runtime.updateGridRail();
assert.equal(ticks.children[0], originalMarker, 'unchanged chrome retains rail buttons');
assert.equal(document.activeElement, originalMarker, 'chrome refresh retains keyboard focus');
assert.equal(lensUpdates, 1, 'unchanged rail does not rewrite lens styles');
assert.equal(observer.takeRecords().length, 0, 'unchanged rail performs no DOM mutations');

runtime.updateGridRailCurrentMarker(4900);
indexReads = 0;
for (let index = 4901; index < 4920; index++) runtime.updateGridRailCurrentMarker(index);
assert.equal(indexReads, 0, 'moving the active row reuses positions without scanning the collection');
const activePosition = () => Number(ticks.querySelector('[aria-current="location"]').dataset.buretGridRailPosition);
assert.ok(activePosition() > 4500);
state.rows = [...rows].reverse();
runtime.updateGridRailCurrentMarker(4999);
assert.equal(activePosition(), 0, 'sorting replaces cached positions');
state.rows.push({ index: 5000, name: 'Appended' });
runtime.updateGridRailCurrentMarker(5000);
assert.ok(activePosition() > 4500, 'remote append refreshes cached positions');
state.rows = [{ index: 5000, name: 'Renamed' }, { index: 2, name: 'Two' }];
runtime.updateGridRail();
assert.equal(ticks.children.length, 2, 'filtering updates marker count');
assert.equal(ticks.children[0].getAttribute('aria-label'), 'Jump to Renamed');
runtime.updateGridRailCurrentMarker(2);
assert.equal(activePosition(), 1, 'replacement preserves source-index navigation');
state.rows[0].name = 'New title';
runtime.updateGridRail();
assert.equal(ticks.children[0].getAttribute('aria-label'), 'Jump to New title', 'renaming updates existing result labels');

const card = document.createElement('div');
card.className = 'buret-card';
card.dataset.index = '2';
card.getBoundingClientRect = () => ({ top: 0 });
grid.appendChild(card);
for (let index = 0; index < 20; index++) runtime.handleGridScroll({});
assert.equal(frames.length, 1, 'scroll events share one animation frame');
frames.shift()();
assert.equal(rangeReads, 1);
assert.equal(chromeUpdates, 0, 'scroll within the retained window only updates its active rail marker');
assert.equal(activePosition(), 1);
observer.disconnect();
window.close();
console.log('Grid rail: stable DOM/focus, cached row positions, sort/filter/append/title updates, coalesced scroll OK.');
