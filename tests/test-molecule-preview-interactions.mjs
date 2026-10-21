import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

const window = new Window();
const document = window.document;
document.body.innerHTML = `<div><button data-buret-molecule-preview-action="lasso"></button><div id="drawing"><svg viewBox="0 0 100 100"><ellipse class="buret-preview-atom atom-0" cx="20" cy="20" data-source-position="1,2,3"/><ellipse class="buret-preview-atom atom-1" cx="80" cy="80" data-source-position="4,5,6"/><path class="bond-0 atom-0 atom-1" d="M20 20L80 80"/></svg></div></div>`;
const image = document.querySelector('#drawing');
const svg = image.querySelector('svg');
// happy-dom does not implement SVG coordinate transforms or pointer capture.
svg.createSVGPoint = () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } });
svg.getScreenCTM = () => ({ inverse: () => ({}) });
Object.defineProperty(svg, 'viewBox', { get: () => {
  const [x, y, width, height] = svg.getAttribute('viewBox').split(' ').map(Number);
  return { baseVal: { x, y, width, height } };
} });
let captured = false;
image.setPointerCapture = () => { captured = true; };
image.hasPointerCapture = () => captured;
image.releasePointerCapture = () => { captured = false; };
const results = [];
const source = readFileSync(new URL('../PreviewExtension/Web/molecule-preview-interactions.js', import.meta.url), 'utf8');
new Function('window', 'document', source)(window, document);
window.BuretteMoleculePreviewInteractions.install(image, positions => results.push(positions));
const wheel = new window.WheelEvent('wheel', { deltaY: -200, clientX: 50, clientY: 50, bubbles: true, cancelable: true });
let leakedWheel = false;
document.body.addEventListener('wheel', () => { leakedWheel = true; });
const zoomOut = () => {
  const event = new window.WheelEvent('wheel', { deltaY: 10000, clientX: 10, clientY: 80, bubbles: true, cancelable: true });
  image.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(leakedWheel, false);
  assert.equal(svg.getAttribute('viewBox'), '0 0 100 100');
};
zoomOut();
image.dispatchEvent(wheel);
assert.equal(wheel.defaultPrevented, true);
assert.equal(leakedWheel, false);
assert.ok(svg.viewBox.baseVal.width < 100);
zoomOut();
image.dispatchEvent(wheel);
image.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
assert.equal(svg.getAttribute('viewBox'), '0 0 100 100');
image.dispatchEvent(new window.Event('burette-toggle-lasso'));
assert.equal(document.querySelector('button').getAttribute('aria-pressed'), 'true');
const pointer = (type, x, y) => image.dispatchEvent(new window.PointerEvent(type, { pointerId: 1, button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true }));
pointer('pointerdown', 10, 10);
pointer('pointermove', 40, 10);
pointer('pointermove', 40, 40);
pointer('pointermove', 10, 40);
pointer('pointerup', 10, 10);
assert.deepEqual(results, [[[1, 2, 3]]]);
assert.equal(svg.querySelectorAll('.buret-preview-atom-selected').length, 1);
assert.equal(svg.querySelector('.buret-preview-lasso-path'), null);
assert.equal(captured, false);
image.parentElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
assert.equal(document.querySelector('button').getAttribute('aria-pressed'), 'false');
// Reinstalling on a new depiction must remove the previous event handlers.
window.BuretteMoleculePreviewInteractions.install(image, positions => results.push(positions));
image.dispatchEvent(new window.Event('burette-toggle-lasso'));
pointer('pointerdown', 60, 60);
pointer('pointermove', 95, 60);
pointer('pointermove', 95, 95);
pointer('pointermove', 60, 95);
pointer('pointerup', 60, 60);
assert.deepEqual(results, [[[1, 2, 3]], [[4, 5, 6]]]);
// Both endpoints select the bond; Escape keeps the drawing selection visible.
pointer('pointerdown', 1, 1);
pointer('pointermove', 99, 1);
pointer('pointermove', 99, 99);
pointer('pointermove', 1, 99);
pointer('pointerup', 1, 1);
assert.equal(svg.querySelectorAll('.buret-preview-bond-selected').length, 1);
image.parentElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
assert.equal(svg.querySelectorAll('.buret-preview-atom-selected').length, 2);
assert.equal(svg.querySelectorAll('.buret-preview-bond-selected').length, 1);
image.dispatchEvent(new window.Event('burette-toggle-lasso'));
pointer('pointerdown', 1, 1);
pointer('pointermove', 5, 1);
pointer('pointermove', 5, 5);
pointer('pointerup', 1, 1);
assert.equal(svg.querySelectorAll('.buret-preview-atom-selected, .buret-preview-bond-selected').length, 0);
image._burettePreviewDispose();
const viewerSource = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const resizeSource = viewerSource.slice(
  viewerSource.indexOf('  function installMolstarMoleculePreviewResize('),
  viewerSource.search(/\n  (?:async )?function molstarPreviewLoadScript\(/u),
);
const actions = [];
const installResize = new Function('window', 'document', 'Element', 'runMolstarMoleculePreviewAction', `
  let molstarMoleculePreviewDrag = null;
  const rememberMolstarMoleculePreviewGeometry = () => {};
  ${resizeSource}
  return installMolstarMoleculePreviewResize;
`)(window, document, window.Element, (action) => actions.push(action));
const card = document.createElement('div');
card.innerHTML = '<div data-buret-molecule-preview-drag><button data-buret-molecule-preview-action="close"><span>Close</span></button></div>';
document.body.appendChild(card);
let cardCaptures = 0;
card.setPointerCapture = () => { cardCaptures++; };
card.releasePointerCapture = () => {};
installResize(card);
const closeGlyph = card.querySelector('span');
closeGlyph.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }));
assert.equal(cardCaptures, 0, 'Close must not capture the pointer as a header drag');
closeGlyph.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
assert.deepEqual(actions, ['close']);
card.firstElementChild.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 2 }));
assert.equal(cardCaptures, 1, 'The header background must remain draggable');
card.dispatchEvent(new window.PointerEvent('pointerup', { pointerId: 2 }));
// Hide survives selection clearing, Escape/resize cleanup and new selections.
// Restoring explicitly opens the current selection; document teardown resets it.
const previewFunction = name => viewerSource.match(new RegExp(`\\n  (?:async )?function ${name}\\([\\s\\S]*?\\n  \\}`, 'u'))[0];
const visibility = new Function(`
  let molstarMoleculePreviewSuppressed = false, molstarMoleculePreviewMinimized = false;
  let molstarMoleculePreview = null, molstarMoleculePreviewTarget = { label: 'GDP A' };
  let molstarMoleculePreviewMinimizedTarget = null, molstarMoleculePreviewFrame = 0;
  let selected = { label: 'GDP A' }, chip = null, shown = [], scheduled = 0;
  const hideMolstarMoleculePreview = () => { molstarMoleculePreview = null; };
  const showMolstarMoleculePreviewChip = label => { chip = label; };
  const removeMolstarMoleculePreviewChip = () => { chip = null; };
  const molstarSelectedMoleculePreviewTarget = () => selected;
  const showMolstarMoleculePreview = target => { shown.push(target.label); };
  const showMolstarSelectedMoleculePreview = () => { scheduled++; return true; };
  ${['dismissMolstarMoleculePreview', 'minimizeMolstarMoleculePreview', 'restoreMolstarMoleculePreview', 'clearMolstarPersistentMoleculePreview', 'scheduleMolstarSelectedMoleculePreview'].map(previewFunction).join('\n')}
  return {
    hide: dismissMolstarMoleculePreview, restore: restoreMolstarMoleculePreview,
    clear: clearMolstarPersistentMoleculePreview, schedule: scheduleMolstarSelectedMoleculePreview,
    select: value => { selected = value; },
    state: () => ({ hidden: molstarMoleculePreviewSuppressed, minimized: molstarMoleculePreviewMinimized, chip, shown, scheduled })
  };
`)();
visibility.hide();
visibility.select(null);
visibility.schedule();
visibility.clear();
visibility.select({ label: 'GDP B' });
visibility.schedule();
assert.deepEqual(visibility.state(), { hidden: true, minimized: true, chip: 'GDP A', shown: [], scheduled: 0 });
visibility.restore();
assert.deepEqual(visibility.state(), { hidden: false, minimized: false, chip: null, shown: ['GDP B'], scheduled: 0 });
visibility.hide();
visibility.clear({ reset: true });
visibility.schedule();
assert.equal(visibility.state().hidden, false);
assert.equal(visibility.state().chip, null);
assert.equal(visibility.state().scheduled, 1);
window.happyDOM.abort();
console.log('2D preview zoom, lasso, cancellation and replacement passed');

// A depiction resolving after a document/card replacement cannot paint the new
// card, even when both molecules share the same cached SVG key and label.
{
  const pending = [];
  let lasso;
  const drawingWindow = new Window();
  drawingWindow.BuretteMoleculePreviewInteractions = { install(_image, handler) { lasso = handler; } };
  const bindings = {
    window: drawingWindow, document: drawingWindow.document,
    normalizeFormat: value => value, molstarMoleculePreviewEntry: target => target.entry,
    molstarPreviewKey: entry => entry.data, molstarPreviewSvgCache: new Map(),
    installMolstarMoleculePreviewResize() {}, applyMolstarMoleculePreviewGeometry() {},
    rememberMolstarMoleculePreviewGeometry() {}, fitMolstarMoleculePreviewDrawing() {},
    escapeHTML: value => value,
    molstarMoleculePreviewCardHTML: (_label, image) => `<div class="buret-molstar-molecule-preview-image">${image}</div>`,
    molstarMoleculePreviewRDKitSVG: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    selectMolstarMoleculePreviewAtoms: target => { selected = target; },
  };
  let selected;
  const api = new Function(...Object.keys(bindings), `
    let molstarMoleculePreview = null, molstarMoleculePreviewTarget = null;
    let molstarMoleculePreviewSuppressed = false, molstarMoleculePreviewMinimized = false;
    ${previewFunction('showMolstarMoleculePreview')}
    return { show: showMolstarMoleculePreview, card: () => molstarMoleculePreview,
      clear() { molstarMoleculePreview?.remove(); molstarMoleculePreview = null; molstarMoleculePreviewTarget = null; } };
  `)(...Object.values(bindings));
  const first = { label: 'MOL A 1', entry: { format: 'sdf', data: 'same chemistry' } };
  const second = { ...first };
  api.show(first); api.clear(); api.show(second);
  pending[0].resolve('<svg id="old-document"/>');
  await Promise.resolve();
  assert.equal(api.card().querySelector('#old-document'), null);
  pending[1].resolve('<svg id="current-document"/>');
  await Promise.resolve();
  assert.ok(api.card().querySelector('#current-document'));
  const third = { ...first };
  api.show(third); pending[2].resolve('<svg id="current-document"/>');
  await Promise.resolve();
  lasso([]);
  assert.equal(selected, third, 'Identical SVGs must use the latest structure owner for 2D selection');
  api.clear();
  lasso([]);
  assert.equal(selected, third, 'Removed cards cannot act on another document');
  api.show(first); api.show({ label: 'different', entry: { format: 'sdf', data: 'different chemistry' } });
  pending[3].resolve('<svg id="old-pose"/>');
  pending[4].resolve('<svg id="new-pose"/>');
  await Promise.resolve();
  assert.equal(api.card().querySelector('#old-pose'), null);
  assert.ok(api.card().querySelector('#new-pose'));
  drawingWindow.happyDOM.abort();
}
console.log('Delayed depictions and shared SVGs retain current document/structure ownership');
