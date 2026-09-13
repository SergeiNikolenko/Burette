import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

const window = new Window();
const { document } = window;
const frames = [];
const tick = () => { for (const run of frames.splice(0)) run(); };
const resize = [];
class ResizeObserver {
  constructor(callback) { resize.push(callback); }
  observe() {}
  disconnect() {}
}
let disposed = 0, measuredHeight;
// The adapter's job is ownership and layout; actual shared Select/resize controls
// are exercised in the browser. Keep the component boundary explicit here.
const mountSelect = (native, role, label) => {
  const node = document.createElement('span');
  const button = document.createElement('button');
  button.textContent = label;
  node.append(button);
  return { node, close() {}, destroy() { disposed++; } };
};
new Function('bindSequenceDrag', 'mountSelect', 'initResize', 'setContentHeight', 'sequenceOptionLabel', 'window', 'document', 'Event', 'ResizeObserver', 'requestAnimationFrame',
  readFileSync(new URL('../apps/desktop/src/preview-sequence/adapter.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, ''))(
  () => () => {}, mountSelect, () => {}, height => { measuredHeight = height; }, label => label, window, document, window.Event, ResizeObserver, callback => frames.push(callback));
document.body.innerHTML = `<div class="msp-sequence"><div class="msp-sequence-select">
  <select><option>1HTB</option></select><select><option>Chain</option><option>Polymers</option></select>
  <select><option value="a">Protein A</option><option value="b">Protein B</option><option disabled>Unavailable</option></select>
  <select><option>A</option></select></div><div class="msp-sequence-wrapper-non-empty"><div class="msp-sequence-wrapper"></div></div></div>`;
const wrapper = document.querySelector('.msp-sequence-wrapper');
Object.defineProperty(document.querySelector('.msp-sequence'), 'clientWidth', { value: 448 });
let panelHeight = 198;
document.querySelector('.msp-sequence').getBoundingClientRect = () => ({ height: panelHeight });
let width = 448;
Object.defineProperty(wrapper, 'clientWidth', { get: () => width });
for (let i = 0; i < 55; i++) {
  if (i % 10 === 0) wrapper.insertAdjacentHTML('beforeend', `<span class="msp-sequence-number">${i + 1}</span>`);
  wrapper.insertAdjacentHTML('beforeend', `<span class="msp-sequence-present" data-seqid="${i}">A</span>`);
}
const originals = Array.from(wrapper.children);
const sync = () => { window.BuretteSequencePanel.sync(); tick(); };
sync();
const reading = document.querySelector('.msp-sequence-wrapper-non-empty');
Object.defineProperty(reading, 'clientWidth', { get: () => width });
reading.getBoundingClientRect = () => ({ top: 40, bottom: 600, height: 560 });
wrapper.getBoundingClientRect = () => ({ bottom: 198 });
document.querySelector('.buret-seq-header').getBoundingClientRect = () => ({ height: 40 });
sync();
assert.equal(measuredHeight, 198, 'height cap follows the last content block, not the stretched reading container');
reading.scrollTop = 50;
wrapper.getBoundingClientRect = () => ({ bottom: 148 });
sync();
assert.equal(measuredHeight, 198, 'scrolling does not change intrinsic content height');
panelHeight = 88;
sync();
assert.equal(wrapper.querySelector('[data-seqid="40"]').style.gridArea, '2 / 45', 'compact track keeps all residues on one horizontal row');
const savedNodes = Array.from(wrapper.children);
wrapper.replaceChildren(...savedNodes.slice(0, 11));
sync();
assert.equal(measuredHeight, 96, 'short chains limit expansion to their content');
wrapper.replaceChildren(...savedNodes);
sync();
assert.equal(measuredHeight, 130, 'switching back to a longer chain raises the ceiling while still compact');
width = 240;
sync();
assert.equal(measuredHeight, 164, 'compact capacity follows the expanded wrapping width');
width = 448;
panelHeight = 198;
sync();
assert.deepEqual(Array.from(wrapper.children), originals, 'Mol* must retain its residue child order and node identity');
assert.equal(wrapper.querySelector('[data-seqid="40"]').style.gridArea, '4 / 1');
assert.equal(wrapper.querySelector('[data-seqid="40"]').previousElementSibling.style.gridArea, '3 / 1');
width = 240;
resize[0](); tick();
assert.equal(wrapper.querySelector('[data-seqid="40"]').style.gridArea, '6 / 1', 'narrow layouts wrap whole ten-residue groups');
const molecule = document.querySelector('[data-role="Molecule"]');
const native = document.querySelectorAll('select')[2];
molecule.querySelector('button').focus();
native.value = 'b';
sync();
assert.equal(document.querySelector('[data-role="Molecule"]').textContent, 'Protein B');
assert.equal(document.activeElement.parentElement.dataset.role, 'Molecule', 'focus survives native option changes');
assert.ok(disposed > 0, 'old component roots are released when native controls change');
const number = wrapper.querySelector('.msp-sequence-number');
const replacement = number.cloneNode(true);
replacement.style.gridArea = '';
number.replaceWith(replacement);
sync();
assert.equal(replacement.style.gridArea, '1 / 1', 'replacement number receives the correct grid location');
wrapper.classList.remove('buret-seq-grid');
sync();
assert.equal(wrapper.classList.contains('buret-seq-grid'), true, 'React class updates do not disable layout');
assert.equal(document.querySelectorAll('.buret-seq-header').length, 1, 'repeated sync does not duplicate controls');
const viewerSource = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const selectionGuard = viewerSource.slice(viewerSource.indexOf('  function installSequenceSelectionMode() {'), viewerSource.indexOf('  function initSequenceResize() {'));
const plugin = { selectionMode: false };
new Function('window', 'document', 'activeMolstarViewer', `${selectionGuard}\ninstallSequenceSelectionMode();`)(window, document, () => ({ plugin }));
const press = node => node.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }));
press(document.querySelector('[data-role="Molecule"]'));
assert.equal(plugin.selectionMode, false, 'browsing a header does not enable selection mode');
press(wrapper.querySelector('[data-seqid]'));
assert.equal(plugin.selectionMode, true);
press(document.querySelector('.buret-seq-title'));
assert.equal(plugin.selectionMode, true, 'header controls preserve selection mode');
press(document.body);
assert.equal(plugin.selectionMode, false, 'returning to the viewport restores its previous mode');
const disposedBeforeUnmount = disposed;
document.querySelector('.msp-sequence').remove();
sync();
assert.ok(disposed > disposedBeforeUnmount, 'unmount disposes shared controls and their portals');
// Resizing only persists explicit user commits; reload restores the preference.
const resizeSetup = viewerSource.slice(viewerSource.indexOf('  function initSequenceResize() {'), viewerSource.indexOf('  function initViewportPanelDrag'));
let storedHeight = '288', resizeOptions;
const resizeWindow = {
  localStorage: { getItem: () => storedHeight, setItem: (_key, value) => { storedHeight = value; } },
  BuretteSequencePanel: { initResize: options => { resizeOptions = options; } },
};
const initResize = new Function('window', 'updateViewportCornerLayout', 'scheduleViewerResize', 'activeMolstarViewer',
  `${resizeSetup} return initSequenceResize;`)(resizeWindow, () => {}, () => {}, () => ({}));
initResize();
assert.equal(resizeOptions.initialHeight, 288);
resizeOptions.onResize();
assert.equal(storedHeight, '288', 'layout correction must not overwrite the preferred size');
resizeOptions.onCommit(320);
initResize();
assert.equal(resizeOptions.initialHeight, 320);
storedHeight = 'NaN';
initResize();
assert.equal(resizeOptions.initialHeight, 196, 'invalid stored values fall back to the readable default');
window.happyDOM.abort();
console.log('Sequence grid identity, responsive layout, native updates, selection guard and cleanup passed');
