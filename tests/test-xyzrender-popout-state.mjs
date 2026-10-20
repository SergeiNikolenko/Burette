import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const window = new Window();
const { document } = window;
const root = document.createElement('div');
const stage = document.createElement('div'); root.append(stage); document.body.append(root);
const sheet = document.createElement('div'); stage.append(sheet);
const snapshot = { version: 1, view: { scale: 1.6, x: 20, y: -30 }, items: [0, 1].map(index => ({
  path: `/molecule-${index}.xyz`, inputDataBase64: 'Mgptb2xlY3VsZQo=', inputExtension: 'xyz',
  svg: `<svg viewBox="0 0 100 80"><circle fill="${index ? 'red' : 'blue'}"></circle></svg>`,
  geometry: { left: 100 + index * 200, top: 90, width: 180, height: 150, rotation: 35 + index },
  selected: index === 1, zIndex: `${index + 1}`, preset: 'pastel',
  controls: { atomScale: 1.4, regions: [{ atoms: '1-2', preset: 'red' }], vdwAtoms: '3' },
  orientationRef: `orientation-${index}`, orientationBaseRef: `base-${index}`, angles: [10, 20, 30],
})) };
const config = { popoutSheet: structuredClone(snapshot) };
const entries = new WeakMap();
const start = source.indexOf('    const restoredSheet = activeConfig?.popoutSheet;');
const end = source.indexOf('    const viewportCleanup =', start);
const restore = new Function('root', 'stage', 'activeConfig', 'ensureXyzrenderSheet', 'addXyzrenderSheetItem', 'setSheetItemRotation', 'setXyzrenderSheetItemRegions', 'setXyzrenderSheetItemVdwAtoms', `let scale=1,translateX=0,translateY=0;\n${source.slice(start, end)}\nreturn {scale,translateX,translateY};`);
const viewport = restore(root, stage, config, () => sheet, (sheet, svg, path, point, serial, scale, entry) => {
  const node = document.createElement('div'); node.className = 'buret-xyzrender-sheet-item'; node.innerHTML = svg; sheet.append(node); entries.set(node, entry); return node;
}, (node, rotation) => { node.dataset.rotation = `${rotation}`; }, (node, regions) => { node.dataset.buretXyzrenderRegions = JSON.stringify(regions); }, (node, atoms) => { node.dataset.buretXyzrenderVdwAtoms = atoms; });
assert.deepEqual(viewport, { scale: 1.6, translateX: 20, translateY: -30 });
assert.equal(config.popoutSheet, undefined, 'one-time checkpoint cannot replay over later edits');
assert.deepEqual([...sheet.children].map(node => ({
  source: entries.get(node), geometry: ['left', 'top', 'width', 'height'].map(key => node.style[key]),
  rotation: node.dataset.rotation, selected: node.classList.contains('selected'), zIndex: node.style.zIndex,
  preset: node.dataset.buretXyzrenderPreset, controls: JSON.parse(node.dataset.buretXyzrenderControls),
  regions: JSON.parse(node.dataset.buretXyzrenderRegions), vdwAtoms: node.dataset.buretXyzrenderVdwAtoms,
  orientation: node.dataset.buretXyzrenderOrientationRef, base: node.dataset.buretXyzrenderOrientationBase,
  angles: JSON.parse(node.dataset.buretXyzrenderOrientationAngles), svg: node.innerHTML,
})), snapshot.items.map(item => ({ source: item, geometry: ['left', 'top', 'width', 'height'].map(key => `${item.geometry[key]}px`), rotation: `${item.geometry.rotation}`, selected: item.selected, zIndex: item.zIndex, preset: item.preset, controls: item.controls, regions: item.controls.regions, vdwAtoms: item.controls.vdwAtoms, orientation: item.orientationRef, base: item.orientationBaseRef, angles: item.angles, svg: item.svg })));
console.log('Composed sheet restores sources, exact SVG appearance, item transforms/styles/orientation/selection and viewport.');
