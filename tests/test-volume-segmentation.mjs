import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Tensor, Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { CustomProperties } from '@molstar/model/model/custom-property';
import { Camera } from '@molstar/graphics/canvas3d/camera';
import { SyncRuntimeContext } from '@molstar/core/task/execution/synchronous';
import { computeBodyMask, writeBodyMaskMrc, computeCandidates, BodyLabels } from '@molstar/volume-tools-extension/segmentor';
import { assignPolygons, assignRemainder } from '@molstar/volume-tools-extension/segmentor/internal/label-ops';

// A non-cubic, translated map catches axis-order and world-origin regressions.
function volume(order) {
  const space = Tensor.Space([8, 6, 4], order, Float32Array);
  const matrix = Mat4.identity();
  Mat4.setTranslation(matrix, Vec3.create(10, 20, 30));
  return {
    label: 'map.mrc',
    grid: { cells: Tensor.create(space, Tensor.Data1(new Float32Array(8 * 6 * 4).fill(1))), transform: { kind: 'matrix', matrix }, stats: { min: 1, max: 1, mean: 1, sigma: 0 } },
    instances: [{ transform: Mat4.identity() }],
    sourceData: { kind: 'test', data: {} },
    customProperties: new CustomProperties(), _propertyData: {}, _localPropertyData: {}
  };
}
function view(polygon) {
  const cameraSnapshot = Camera.createDefaultSnapshot();
  Object.assign(cameraSnapshot, { mode: 'orthographic', position: Vec3.create(13.5, 22.5, 130), target: Vec3.create(13.5, 22.5, 30), up: Vec3.create(0, 1, 0), radius: 20, radiusMax: 200 });
  return { id: 'view', label: 'View', polygon, canvasWidth: 100, canvasHeight: 100, viewportWidth: 100, viewportHeight: 100, cameraSnapshot };
}
for (const order of [[2, 1, 0], [0, 1, 2]]) {
  const map = volume(order);
  const original = map.grid.cells.data.slice();
  const store = BodyLabels.ensure(map);
  const candidates = computeCandidates(map, 0.5);
  const left = view([[0, 0], [50, 0], [50, 100], [0, 100]]);
  const top = view([[0, 0], [100, 0], [100, 50], [0, 50]]);
  const count = await assignPolygons(store.labels, candidates, map, [left, top], 1, 'replace', SyncRuntimeContext);
  assert.equal(count, 4 * 3 * 4);
  assert.equal(assignRemainder(store.labels, candidates, 2), 8 * 6 * 4 - count);
  const result = await computeBodyMask(map, store.labels, 1, { extend: 0, softEdge: 0, pruneBelowThreshold: true }, 0.5, SyncRuntimeContext);
  assert.equal(result.voxelCount, count);
  const mrc = writeBodyMaskMrc(map, result);
  const header = new DataView(mrc);
  assert.deepEqual([0, 4, 8].map(offset => header.getInt32(offset, true)), [8, 6, 4]);
  assert.equal(header.getInt32(12, true), 2);
  assert.equal(header.getInt32(88, true), 1);
  assert.deepEqual([196, 200, 204].map(offset => header.getFloat32(offset, true)), [10, 20, 30]);
  assert.equal(new TextDecoder().decode(new Uint8Array(mrc, 208, 4)), 'MAP ');
  const mask = new Float32Array(mrc, 1024);
  for (let z = 0; z < 4; z++) for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) {
    assert.equal(mask[x + 8 * (y + 6 * z)], x < 4 && y >= 3 ? 1 : 0);
  }
  const soft = await computeBodyMask(map, store.labels, 1, { extend: 0, softEdge: 2, pruneBelowThreshold: true }, 0.5, SyncRuntimeContext);
  assert.ok(soft.data.some(value => value > 0 && value < 1));
  assert.deepEqual(map.grid.cells.data, original, 'Segmentation and export preserve source density');
}
console.log('Volume segmentation preserves multiview labels, source density, axis order and MRC grid geometry.');

// Exercise the shipped panel with a real plugin state/manager and its export callback.
const { Window } = await import('happy-dom');
const dom = new Window();
globalThis.window = dom;
globalThis.document = dom.document;
const { PluginContext } = await import('@molstar/plugin/context');
const { PluginStateObject: SO, PluginStateTransform } = await import('@molstar/plugin/state/objects');
const { VolumeSegmentorManager } = await import('@molstar/volume-tools-extension/segmentor');
const { BuretteVolumeSegmentation } = await import('../scripts/molstar-volume-segmentation.js');
const { BuretteVolumeSegmentationState: Saved } = await import('../scripts/molstar-volume-segmentation-state.js');
const { DefaultPluginSpec } = await import('@molstar/plugin/default-spec');
const { CCP4Writer } = await import('@molstar/model/formats/writer/ccp4/ccp4');
// Use the actual parsed tensor extent for non-cubic and cropped CCP4 labels.
for (const cropped of [false, true]) {
  const dimensionPlugin = new PluginContext({ ...DefaultPluginSpec(), behaviors: [] });
  await dimensionPlugin.init();
  const source = volume([0, 1, 2]);
  const buffer = CCP4Writer.writeMrc(source.grid, source.grid.cells.data);
  if (cropped) {
    const header = new DataView(buffer);
    for (const offset of [28, 32, 36]) header.setInt32(offset, header.getInt32(offset, true) * 2, true);
  }
  const raw = await dimensionPlugin.builders.data.rawData({ data: new Uint8Array(buffer), label: 'non-cubic.mrc' });
  const parsed = await dimensionPlugin.dataFormats.get('ccp4').parse(dimensionPlugin, raw);
  assert.equal(parsed.volume.obj.description, 'Volume 8×6×4');
  assert.deepEqual(Array.from(parsed.volume.obj.data.grid.cells.space.dimensions), [8, 6, 4]);
  dimensionPlugin.dispose();
}
const plugin = new PluginContext({ ...DefaultPluginSpec(), behaviors: [] });
await plugin.init();
const testMap = volume([0, 1, 2]);
const LoadMap = PluginStateTransform.BuiltIn({ name: 'burette-test-volume-segmentation', from: SO.Root, to: SO.Volume.Data, params: {} })({ apply: () => new SO.Volume.Data(volume([0, 1, 2]), { label: 'Map <test>' }) });
await plugin.state.data.build().toRoot().apply(LoadMap, {}).commit();
const downloads = [], errors = [];
const panel = BuretteVolumeSegmentation.panel(plugin, { download: (blob, name) => downloads.push({ blob, name }), onError: error => errors.push(error) });
const sceneTree = document.createElement('div'); sceneTree.id = 'buret-scene-tree';
const sceneToggle = document.createElement('button'); sceneToggle.id = 'buret-scene-tree-toggle';
sceneTree.append(panel); document.body.append(sceneTree, sceneToggle);
assert.equal(panel.hidden, false);
assert.equal(VolumeSegmentorManager.get(plugin), undefined, 'Opening a map does not recolor it before segmentation is requested');
panel.open = true;
panel.dispatchEvent(new dom.Event('toggle'));
async function settle(check) {
  for (let i = 0; i < 100; i++) {
    if (errors.length) throw errors[0];
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Panel operation did not complete');
}
await settle(() => !!panel.querySelector('button') && !panel.querySelector('button').disabled);
const click = label => {
  const button = [...panel.querySelectorAll('button')].find(node => node.textContent === label);
  assert.ok(button && !button.disabled, `${label} is available`);
  button.focus();
  button.click();
};
const styles = document.createElement('style');
styles.textContent = readFileSync(new URL('../PreviewExtension/Web/viewer-runtime.css', import.meta.url), 'utf8');
document.head.append(styles);
assert.equal(dom.getComputedStyle([...panel.querySelectorAll('summary')].find(node => node.textContent === 'Map tools')).pointerEvents, 'auto', 'Nested map tools remain clickable');
// v6 layout.root is the inner canvas parent; .msp-viewport is its ancestor.
// Drawing must mount against the actual canvas, not query descendants of root.
const viewport = document.createElement('div'); viewport.className = 'msp-viewport';
const canvasParent = document.createElement('div'); const renderCanvas = document.createElement('canvas');
canvasParent.append(renderCanvas); viewport.append(canvasParent); document.body.append(viewport);
canvasParent.getBoundingClientRect = () => ({ width: 100, height: 100, left: 0, top: 0, right: 100, bottom: 100 });
const originalCanvas3d = plugin.canvas3d, originalContext = plugin.canvas3dContext;
plugin.layout.setRoot(canvasParent);
const drawingSnapshot = Camera.createDefaultSnapshot(); drawingSnapshot.radius = 20; drawingSnapshot.radiusMax = 200;
plugin.canvas3d = { camera: { getSnapshot: () => drawingSnapshot, viewport: { width: 100, height: 100 } } };
plugin.canvas3dContext = { canvas: renderCanvas };
globalThis.ResizeObserver = dom.ResizeObserver;
click('Add body');
await settle(() => !panel.querySelector('button').disabled);
assert.equal(document.activeElement.textContent, 'Add body', 'An action retains keyboard focus after its state updates');
const outsideControl = document.createElement('input'); document.body.append(outsideControl); outsideControl.focus();
await VolumeSegmentorManager.get(plugin).setBodyColor(VolumeSegmentorManager.get(plugin).activeBody.id, 0x123456);
assert.equal(document.activeElement, outsideControl, 'Background updates do not steal focus from another control');
outsideControl.remove();
click('Draw polygon');
await settle(() => !!canvasParent.querySelector('.buret-volume-polygon'));
const overlay = canvasParent.querySelector('.buret-volume-polygon');
assert.equal(document.activeElement, overlay);
overlay.dispatchEvent(new dom.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
await settle(() => !canvasParent.querySelector('.buret-volume-polygon') && !panel.querySelector('button').disabled);
assert.equal(document.activeElement.dataset.focusKey, 'draw-polygon', 'Escape returns focus to the drawing control');
const originalGetContext = dom.HTMLCanvasElement.prototype.getContext;
dom.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {} });
click('Draw polygon');
await settle(() => !!canvasParent.querySelector('.buret-volume-polygon'));
const keyboardOverlay = canvasParent.querySelector('.buret-volume-polygon');
let leakedKeys = 0;
const outsideKey = () => { leakedKeys++; };
viewport.addEventListener('keydown', outsideKey);
for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft']) keyboardOverlay.dispatchEvent(new dom.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
keyboardOverlay.dispatchEvent(new dom.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
await settle(() => !canvasParent.querySelector('.buret-volume-polygon') && !panel.querySelector('button').disabled);
assert.equal(VolumeSegmentorManager.get(plugin).activeBody.views.length, 1, 'Keyboard vertices and Enter save a polygon');
assert.equal(document.activeElement.dataset.focusKey, 'draw-polygon', 'Completing a polygon returns keyboard focus');
assert.equal(leakedKeys, 0, 'Drawing keys do not trigger viewport navigation');
viewport.removeEventListener('keydown', outsideKey);
click('Draw polygon');
await settle(() => !!canvasParent.querySelector('.buret-volume-polygon'));
const viewerSource = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const sceneVisibility = viewerSource.slice(viewerSource.indexOf('  function setSceneTreeOpen(open) {'), viewerSource.indexOf('  // Several structures at once', viewerSource.indexOf('  function setSceneTreeOpen(open) {')));
const visibility = vm.createContext({ document, window: { molstar: { BuretteVolumeSegmentation } }, activeMolstarViewer: () => ({ plugin }), moveSceneTreeHighlight() {}, closeSceneTreeMenu() {}, updateViewportCornerLayout() {}, renderSceneTree() {} });
vm.runInContext(`${sceneVisibility}\nsetSceneTreeOpen(false);`, visibility);
assert.equal(canvasParent.querySelector('.buret-volume-polygon'), null, 'Closing the scene panel removes its drawing overlay');
assert.equal(VolumeSegmentorManager.get(plugin).state.isDrawing, false);
vm.runInContext('setSceneTreeOpen(false); setSceneTreeOpen(true);', visibility);
BuretteVolumeSegmentation.cancelDrawing(plugin);
BuretteVolumeSegmentation.cancelDrawing(undefined);
assert.equal(canvasParent.querySelector('.buret-volume-polygon'), null, 'Repeated cleanup without drawing is a no-op');
dom.HTMLCanvasElement.prototype.getContext = originalGetContext;
plugin.canvas3d = originalCanvas3d; plugin.canvas3dContext = originalContext;
click('Remove body');
await settle(() => !VolumeSegmentorManager.get(plugin).state.bodies.length && !panel.querySelector('button').disabled);
click('Remainder');
await settle(() => VolumeSegmentorManager.get(plugin)?.state.bodies[0]?.voxelCount === 192 && !panel.querySelector('button').disabled);
const name = panel.querySelector('input[name="name"]');
name.value = 'Saved body'; name.dispatchEvent(new dom.Event('change'));
await settle(() => !panel.querySelector('button').disabled);
const targetRef = VolumeSegmentorManager.get(plugin).state.targetVolumeRef;
assert.equal(Saved.definition(plugin, targetRef).bodies[0].name, 'Saved body');
const changeNumber = async (field, value) => {
  const input = panel.querySelector(`input[name="${field}"]`);
  input.focus();
  input.value = String(value); input.dispatchEvent(new dom.Event('change'));
  await settle(() => !panel.querySelector('button').disabled);
  assert.equal(document.activeElement.name, field, 'A changed field retains keyboard focus');
};
await changeNumber('extend-voxels-', 3);
await changeNumber('soft-edge-voxels-', 1);
assert.deepEqual({ extend: VolumeSegmentorManager.get(plugin).activeBody.extend, softEdge: VolumeSegmentorManager.get(plugin).activeBody.softEdge }, { extend: 3, softEdge: 1 });
const preview = panel.querySelector('select[name="preview"]');
preview.value = 'active'; preview.dispatchEvent(new dom.Event('change'));
await settle(() => !panel.querySelector('button').disabled);
const snapshot = JSON.parse(JSON.stringify(plugin.state.data.getSnapshot()));
assert.ok(JSON.stringify(snapshot).includes('Saved body'));
const restored = new PluginContext({ ...DefaultPluginSpec(), behaviors: [] });
await restored.init();
await restored.runTask(restored.state.data.setSnapshot(snapshot));
assert.deepEqual([...restored.state.data.cells.values()].filter(cell => cell.status !== 'ok').map(cell => cell.errorText), []);
const restoredMap = Saved.volumes(restored)[0].cell.obj.data;
assert.equal(BodyLabels.get(restoredMap).bodies[0].name, 'Saved body');
assert.equal(BodyLabels.get(restoredMap).labels.filter(value => value === BodyLabels.get(restoredMap).bodies[0].id).length, 192);
assert.equal(Saved.definition(restored, targetRef).bodies[0].extend, 3);
assert.equal(Saved.definition(restored, targetRef).bodies[0].softEdge, 1);
restored.dispose();
const activeManager = VolumeSegmentorManager.get(plugin);
await activeManager.buretteSetThreshold({ kind: 'absolute', absoluteValue: 0.5 });
await Saved.persist(plugin, activeManager);
await Saved.edit(plugin, activeManager, { kind: 'dust', minVoxels: 193, threshold: 0.5 });
assert.ok(activeManager.volume.grid.cells.data.every(value => value === 0));
assert.ok([...plugin.state.data.cells.values()].find(cell => cell.transform.transformer === LoadMap).obj.data.grid.cells.data.every(value => value === 1), 'Map edits preserve the loaded source');
const editedSnapshot = JSON.parse(JSON.stringify(plugin.state.data.getSnapshot()));
const editedRestore = new PluginContext({ ...DefaultPluginSpec(), behaviors: [] });
await editedRestore.init();
await editedRestore.runTask(editedRestore.state.data.setSnapshot(editedSnapshot));
assert.ok(Saved.volumes(editedRestore)[0].cell.obj.data.grid.cells.data.every(value => value === 0), 'Map edits replay during scene restoration');
const mobilePanel = BuretteVolumeSegmentation.panel(editedRestore, { download() { throw new Error('Unsupported mobile export'); }, onError: error => errors.push(error), canExport: false });
document.body.append(mobilePanel); mobilePanel.open = true; mobilePanel.dispatchEvent(new dom.Event('toggle'));
await settle(() => !!mobilePanel.querySelector('button') && !mobilePanel.querySelector('button').disabled);
assert.equal(mobilePanel.querySelector('select[name="export"]'), null);
assert.equal([...mobilePanel.querySelectorAll('button')].some(button => button.textContent.startsWith('Export')), false);
editedRestore.dispose();
await Saved.edit(plugin, activeManager, 'undo');
assert.ok(activeManager.volume.grid.cells.data.every(value => value === 1));
assert.equal(activeManager.activeBody.extend, 3);
assert.equal(activeManager.activeBody.softEdge, 1);
const malformed = structuredClone(snapshot);
const badDefinition = malformed.tree.transforms.find(transform => transform.transformer === 'ms-plugin.burette-volume-body-definitions');
badDefinition.params.definition.bodies[0].remainder = 'false';
const invalidRestore = new PluginContext({ ...DefaultPluginSpec(), behaviors: [] });
await invalidRestore.init();
const reportError = console.error;
try { console.error = () => {}; await invalidRestore.runTask(invalidRestore.state.data.setSnapshot(malformed)); } finally { console.error = reportError; }
assert.ok([...invalidRestore.state.data.cells.values()].some(cell => cell.status === 'error' && /Invalid map body/.test(cell.errorText)));
invalidRestore.dispose();
const mode = panel.querySelector('select[name="export"]');
mode.value = 'mrc'; mode.dispatchEvent(new dom.Event('change'));
await settle(() => !panel.querySelector('button').disabled);
click('Export masks');
await settle(() => downloads.length === 1 && !panel.querySelector('button').disabled);
assert.equal(downloads[0].name, 'map_body001_mask.mrc');
assert.equal(downloads[0].blob.size, 1024 + 192 * 4);
assert.deepEqual(Array.from(new Float32Array(await downloads[0].blob.arrayBuffer(), 1024)), new Array(192).fill(1));
click('Remove body');
await settle(() => !VolumeSegmentorManager.get(plugin)?.state.bodies.length && !panel.querySelector('button').disabled);
click('Undo');
await settle(() => VolumeSegmentorManager.get(plugin)?.state.bodies.length === 1 && !panel.querySelector('button').disabled);
assert.equal(panel.querySelector('input[name="name"]').value, 'Saved body');
assert.deepEqual(errors, []);
await plugin.clear();
BuretteVolumeSegmentation.panel(plugin, { download() {}, onError: error => errors.push(error) });
await settle(() => VolumeSegmentorManager.get(plugin)?.state.targetVolumeRef === undefined);
assert.equal(panel.hidden, true);
assert.deepEqual(errors, [], 'Clearing a map drains its pending theme and target updates');
plugin.dispose();
assert.equal(VolumeSegmentorManager.get(plugin), undefined, 'Plugin disposal releases the segmentation manager');
await dom.happyDOM.close();
console.log('Volume panel preserves names, per-body widths, masks and density edits through scene snapshots; export, undo, mobile capabilities and clear lifecycle pass.');
