import { afterAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { PluginContext } from '@molstar/plugin';
import { DefaultPluginSpec } from '@molstar/plugin/default-spec';
import { StructureElement } from '@molstar/model/model/structure';
import { Canvas3DParams } from '@molstar/graphics/canvas3d/canvas3d';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { Camera } from '@molstar/graphics/canvas3d/camera';
import { setCanvasModule } from '@molstar/graphics/geo/geometry/text/font-atlas';
import { BuretteGeometry } from '../scripts/molstar-geometry.js';
import { BuretteTopologyScene } from '../scripts/molstar-topology-scene.js';
import { patchSceneLayers, listSceneLayers } from '../scripts/molstar-scene-layers.js';

const dom = new Window({ url: 'http://localhost/' }), previous = new Map();
Object.assign(dom, { setImmediate, clearImmediate });
for (const [key, value] of Object.entries({ window: dom, document: dom.document })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
afterAll(async () => {
  for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  await dom.happyDOM.close();
});
setCanvasModule({ createCanvas: () => ({ getContext: () => ({ measureText: () => ({ width: 12 }), clearRect() {}, fillText() {},
  getImageData: (_x, _y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
}) }) });
const xyz = '4\nsource\nO 0 0 0\nH 1 0 0\nH 0 1 0\nC 0 0 1\n';
const reordered = '5\ncandidate\nC 0 0 1\nH 1 0 0\nO 0 0 0\nH 0 1 0\nHe 0 0 2\n';
const mol = ['Graph', 'Burette', '', '  2  1  0  0  0  0            999 V2000',
  '    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
  '    1.0000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0', '  1  2  1  0  0  0  0', 'M  END', ''].join('\n');
const digest = text => createHash('sha256').update(text).digest('hex');
async function make(text = xyz, format = 'xyz') {
  const plugin = new PluginContext(DefaultPluginSpec()); await plugin.init();
  const raw = await plugin.builders.data.rawData({ data: text, label: 'Exact source label' });
  const trajectory = await plugin.builders.structure.parseTrajectory(raw, format);
  await plugin.builders.structure.hierarchy.applyPreset(trajectory, 'default', { representationPreset: 'empty' });
  const root = plugin.managers.structure.hierarchy.current.structures[0].cell;
  const component = await plugin.builders.structure.tryCreateComponentStatic(root.transform.ref, 'all');
  await plugin.builders.structure.representation.addRepresentation(component, { type: 'ball-and-stick', color: 'element-symbol' });
  const loci = indices => StructureElement.Loci(root.obj.data, [{ unit: root.obj.data.units[0], indices: Int32Array.from(indices) }]);
  cameraFor({ plugin });
  return { plugin, raw, root, component, loci };
}
function cameraFor(viewer) {
  const original = viewer.plugin.canvas3d, camera = new Camera();
  viewer.plugin.canvas3d = { camera, props: structuredClone(PD.getDefaultValues(Canvas3DParams)),
    setProps(props) { for (const [key, value] of Object.entries(props)) this.props[key] = value && typeof value === 'object' && !Array.isArray(value) ? { ...this.props[key], ...structuredClone(value) } : value; },
    dispose() {}, add() {}, remove() {}, commit() {}, syncVisibility() {}, mark() {}, requestCameraReset({ snapshot }) { camera.setState(snapshot, 0); } };
  return { camera, dispose() { viewer.plugin.canvas3d = original; } };
}
const code = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const extract = name => code.match(new RegExp(`\\n  (?:async )?function ${name}\\([\\s\\S]*?\\n  \\}`, 'u'))[0];
const cameraStepEnd = code.indexOf('    {\n      const poseCount =', code.indexOf('  async function startMolstar('));
const cameraStepStart = code.lastIndexOf('    if (window.BuretteViewerDisposed) return;', cameraStepEnd);
const cameraStep = code.slice(cameraStepStart, cameraStepEnd);
const action = extract('executeBuretteAgentAction'), globals = code.slice(code.indexOf('  let geometryPreviewRequest ='), code.indexOf(action));
const receiverStart = code.indexOf("  window.addEventListener('message', event => {", code.indexOf(action));
const receiver = code.slice(receiverStart, code.indexOf('  window.BuretteViewerActions =', receiverStart));
const deferred = () => { let resolve; return { promise: new Promise(done => { resolve = done; }), resolve: () => resolve() }; };
function harness(viewer, options = {}) {
  let active = viewer, receive, counter = 0, sdkCalls = 0;
  const server = { molstar: { BuretteGeometry, BuretteTopologyScene, lib: { structure: { StructureElement } } },
    BuretteAgent: { run() { sdkCalls++; throw new Error('Private route reached SDK'); } }, addEventListener(_type, listener) { receive = listener; } };
  const context = { window: server, crypto, TextEncoder, TextDecoder, Uint8Array, Float64Array, File };
  const load = name => vm.runInNewContext(readFileSync(new URL(`../PreviewExtension/Web/${name}.js`, import.meta.url), 'utf8'), context);
  load('scene-file-actions');
  const loadScript = async url => {
    if (!String(url).includes('measurement-coordinate.js')) throw new Error('Unexpected module load');
    options.entered?.resolve(); if (options.wait) await options.wait.promise;
    load('measurement-coordinate');
  };
  const bootstrap = new Function('window', 'document', 'activeMolstarViewer', 'loadScript', 'runtimeURL',
    `${globals}\n${action}\n${extract('agentActionFailure')}\n${extract('measurementCoordinateRuntime')}\n${extract('restoreMeasurementPreview')}\n${receiver}\nreturn restoreMeasurementPreview;`)(server, dom.document, () => active, loadScript, (_key, fallback) => new URL(fallback, dom.document.baseURI).toString());
  return { server, bootstrap, setActive(next) { active = next; }, get sdkCalls() { return sdkCalls; },
    async finalize(config, settings = {}) {
      const calls = { read: 0, transfer: 0, save: 0, focus: [] }, values = new Map();
      server.sessionStorage = { getItem(key) { return values.get(key) ?? null; }, setItem(key, value) { values.set(key, value); } };
      load('renderer-view-state');
      const state = server.BuretteRendererViewState;
      if (settings.savedCamera) state.save(config.documentId, { camera: settings.savedCamera });
      const read = state.read, transfer = state.transferCamera;
      state.read = (...args) => { calls.read++; return read(...args); };
      state.transferCamera = (...args) => { calls.transfer++; return transfer(...args); };
      const restoreCamera = new Function(extract('restoreMolstarCameraSnapshotNow') + '\nreturn restoreMolstarCameraSnapshotNow;')();
      const run = new Function('window', 'viewer', 'config', 'prepared', 'restoredView', 'restoreMeasurementPreview',
        'hasMolstarContextFocus', 'isQuickLookHost', 'restoreMolstarCameraSnapshotNow', 'saveRendererViewState', 'scheduleMolstarStructureFocus',
        `return (async () => { let molstarStructureFocusSerial = 0; ${cameraStep} return molstarStructureFocusSerial; })();`);
      calls.serial = await run(server, active, config, settings.prepared ?? { kind: 'xyz' }, Promise.resolve(settings.sourceViewport), bootstrap,
        () => Boolean(settings.contextFocus), () => Boolean(settings.quickLook), restoreCamera, () => { calls.save++; },
        (_viewer, options) => { calls.focus.push(options); });
      return calls;
    },
    send(command) { return new Promise(resolve => receive({ data: { source: 'burette-agent-host', body: { type: 'agent-action', id: `request-${++counter}`, action: command } },
      source: { postMessage(reply) { resolve(reply.body.result); } } })); } };
}
const measurements = viewer => [...viewer.plugin.state.data.cells.values()].filter(cell => cell.obj?.label === 'Distance' && String(cell.transform.transformer.id).includes('structure-selections-'));
const transfer = value => ({ version: 1, sourceFormat: value.sourceFormat, targetSourceSha256: value.sourceSha256, atomCount: value.atomCount, items: value.items, group: value.group });

async function preparedSource() {
  const source = await make(), h = harness(source);
  await patchSceneLayers(source.plugin, { operations: [{ type: 'create', layerId: 'oxygen-carbon', structureId: source.root.transform.ref,
    expression: { atoms: [0, 3] }, appearance: { type: 'spacefill', color: { name: 'uniform', value: '#12ab34' }, opacity: .4 }, label: 'Exact layer', visible: false }],
    check() {}, resolve() { return { entry: { ref: source.root.transform.ref, data: source.root.obj.data }, loci: source.loci([0, 3]) }; } });
  await source.plugin.managers.structure.measurement.addDistance(source.loci([0]), source.loci([3]), { visualParams: { customText: 'Exact distance' } });
  source.plugin.managers.structure.selection.fromLoci('set', source.loci([1, 3]), false);
  const canvas = cameraFor(source); canvas.camera.setState({ position: [8, 9, 10], target: [1, 2, 3], radius: 4 }, 0);
  const lease = BuretteGeometry.binding(source.plugin).lease;
  const capturedMeasurements = await h.send({ type: 'measurement_preview_capture', sourceExtension: 'xyz', lease });
  expect(capturedMeasurements.ok).toBe(true);
  const capturedScene = await h.send({ type: 'geometry_topology_scene_capture', lease }); expect(capturedScene).toMatchObject({ ok: true });
  const { receipt, ...scene } = capturedScene.result;
  scene.atomCount = 5; scene.selection = [0, 1]; scene.components.find(item => item.layerId === 'oxygen-carbon').indices = [0, 2];
  const measurement = { ...transfer(capturedMeasurements.result), targetSourceSha256: digest(reordered), atomCount: 5,
    items: capturedMeasurements.result.items.map(item => ({ ...item, points: [[2], [0]] })) };
  return { source, h, canvas, lease, receipt, scene, measurement };
}

test('private dispatcher preserves graph capture and forwards explicit XYZ lease without SDK fallback', async () => {
  const xyzViewer = await make(), graph = await make(mol, 'mol');
  try {
    const h = harness(xyzViewer), lease = BuretteGeometry.binding(xyzViewer.plugin).lease;
    const before = xyzViewer.plugin.state.data.getSnapshot();
    const response = await h.send({ type: 'measurement_preview_capture', sourceExtension: 'xyz', lease });
    expect(response).toMatchObject({ ok: true, result: { sourceFormat: 'xyz', sourceSha256: digest(xyz) } });
    expect(xyzViewer.plugin.state.data.getSnapshot()).toEqual(before);
    expect((await h.send({ type: 'measurement_preview_capture', sourceExtension: 'xyz' })).ok).toBe(false);
    h.setActive(graph);
    expect((await h.send({ type: 'measurement_preview_capture' })).result.sourceFormat).toBe('mol');
    expect(h.sdkCalls).toBe(0);
  } finally { xyzViewer.plugin.dispose(); graph.plugin.dispose(); }
});

test('scene capture and validate use the same opaque receipt and refuse changed native settings', async () => {
  const v = await make();
  try {
    const h = harness(v), lease = BuretteGeometry.binding(v.plugin).lease;
    const captured = await h.send({ type: 'geometry_topology_scene_capture', lease }); expect(captured.ok).toBe(true);
    expect(typeof captured.result.receipt).toBe('string');
    expect(await h.send({ type: 'geometry_topology_scene_validate', lease, receipt: captured.result.receipt })).toEqual({ ok: true, result: { valid: true } });
    expect((await h.send({ type: 'geometry_topology_scene_validate', lease, receipt: 'foreign' })).ok).toBe(false);
    v.plugin.state.data.updateCellState(v.component.ref, { isHidden: true });
    const before = v.plugin.state.data.getSnapshot();
    const rejected = await h.send({ type: 'geometry_topology_scene_validate', lease, receipt: captured.result.receipt });
    expect(rejected.ok).toBe(false); expect(rejected.error.message).toContain('scene changed'); expect(v.plugin.state.data.getSnapshot()).toEqual(before);
    expect((await h.send({ type: 'geometry_topology_scene_capture' })).ok).toBe(false);
    expect(h.sdkCalls).toBe(0);
  } finally { v.plugin.dispose(); }
});

test('a viewer replaced during runtime loading cannot produce a late measurement capture', async () => {
  const old = await make(), replacement = await make(), entered = deferred(), wait = deferred();
  try {
    const h = harness(old, { entered, wait }), lease = BuretteGeometry.binding(old.plugin).lease;
    const pending = h.send({ type: 'measurement_preview_capture', sourceExtension: 'xyz', lease });
    await entered.promise; h.setActive(replacement); wait.resolve();
    const response = await pending;
    expect(response.ok).toBe(false); expect(response.error.message).toBe('The Geometry source or viewer changed.'); expect(h.sdkCalls).toBe(0);
  } finally { old.plugin.dispose(); replacement.plugin.dispose(); }
});

test('actual bootstrap restores scene layers/selection/camera before measurements for the unread candidate', async () => {
  const prepared = await preparedSource(), candidate = await make(reordered), canvas = cameraFor(candidate);
  try {
    const h = harness(candidate);
    await h.bootstrap(candidate, { rendererViewState: JSON.stringify({ topologyScene: prepared.scene, measurementTransfer: prepared.measurement }) });
    expect(listSceneLayers(candidate.plugin).map(layer => [layer.layerId, layer.visible])).toEqual([['oxygen-carbon', false]]);
    expect(measurements(candidate)).toHaveLength(1);
    expect(canvas.camera.getSnapshot()).toEqual(prepared.canvas.camera.getSnapshot());
    const current = await h.send({ type: 'measurement_preview_capture', sourceExtension: 'xyz', lease: BuretteGeometry.binding(candidate.plugin).lease });
    expect(transfer(current.result)).toEqual(prepared.measurement);
    const scene = await h.send({ type: 'geometry_topology_scene_capture', lease: BuretteGeometry.binding(candidate.plugin).lease });
    expect(scene.result.selection).toEqual([0, 1]); expect(scene.result.components.find(item => item.layerId === 'oxygen-carbon').indices).toEqual([0, 2]);
    expect(candidate.raw.cell.params.values.data).toBe(reordered);
  } finally { canvas.dispose(); prepared.canvas.dispose(); prepared.source.plugin.dispose(); candidate.plugin.dispose(); }
});

test('bootstrap rejects a native receipt in candidate data or a replacement during measurement module load', async () => {
  const prepared = await preparedSource(), candidate = await make(reordered), replacement = await make(reordered);
  try {
    const h = harness(candidate);
    await expect(h.bootstrap(candidate, { rendererViewState: JSON.stringify({ topologyScene: { ...prepared.scene, receipt: prepared.receipt } }) })).rejects.toThrow('Invalid topology');
    expect(measurements(candidate)).toHaveLength(0);
    const entered = deferred(), wait = deferred(), held = harness(candidate, { entered, wait });
    const pending = held.bootstrap(candidate, { rendererViewState: JSON.stringify({ topologyScene: prepared.scene, measurementTransfer: prepared.measurement }) });
    await entered.promise; held.setActive(replacement); wait.resolve();
    await expect(pending).rejects.toThrow('source or viewer changed'); expect(measurements(candidate)).toHaveLength(0); expect(measurements(replacement)).toHaveLength(0);
  } finally { prepared.canvas.dispose(); prepared.source.plugin.dispose(); candidate.plugin.dispose(); replacement.plugin.dispose(); }
});


for (const scenario of [{ name: 'no cache' }, { name: 'stale saved camera', cached: true }, { name: 'Quick Look fitting', quickLook: true }]) test(`topology camera wins the actual final step with ${scenario.name}`, async () => {
  const prepared = await preparedSource(), candidate = await make(reordered), canvas = cameraFor(candidate);
  try {
    Object.assign(canvas.camera.viewport, { width: 200, height: 400 });
    const h = harness(candidate), config = { documentId: 'candidate-camera', rendererViewState: JSON.stringify({ topologyScene: prepared.scene, measurementTransfer: prepared.measurement }) };
    const calls = await h.finalize(config, { savedCamera: scenario.cached ? { ...prepared.scene.camera, position: [99, 88, 77], radius: 20 } : null,
      sourceViewport: { width: 1200, height: 400 }, quickLook: scenario.quickLook, prepared: { kind: 'xyz', fitSessionCamera: scenario.quickLook } });
    expect(canvas.camera.getSnapshot()).toEqual(prepared.scene.camera);
    expect(calls).toEqual({ read: 0, transfer: 0, save: 0, focus: [], serial: 1 });
    expect(measurements(candidate)).toHaveLength(1);
  } finally { canvas.dispose(); prepared.canvas.dispose(); prepared.source.plugin.dispose(); candidate.plugin.dispose(); }
});

test('the actual final camera step preserves ordinary saved/fit/initial/session behavior without topology', async () => {
  const v = await make(), canvas = cameraFor(v);
  try {
    const h = harness(v), config = { documentId: 'ordinary-camera' }, saved = { ...canvas.camera.getSnapshot(), position: [10, 12, 14], radius: 3 };
    Object.assign(canvas.camera.viewport, { width: 200, height: 400 });
    const result = await h.finalize(config, { savedCamera: saved, sourceViewport: { width: 1200, height: 400 } });
    expect(result).toEqual({ read: 1, transfer: 1, save: 1, focus: [], serial: 1 });
    expect(canvas.camera.getSnapshot().position).toEqual(h.server.BuretteRendererViewState.transferCamera(saved, { width: 1200, height: 400 }, canvas.camera.viewport).position);
    expect((await h.finalize(config)).focus).toEqual([{ reason: 'initial-load', durationMs: 120 }]);
    expect((await h.finalize(config, { quickLook: true })).focus.map(value => [value.reason, value.durationMs, value.force])).toEqual([['quick-look-frame', 0, true]]);
    expect((await h.finalize(config, { prepared: { kind: 'session', hasSessionCamera: true } })).focus).toEqual([]);
    expect((await h.finalize(config, { contextFocus: true })).focus).toEqual([]);
    expect(await h.bootstrap(v, config)).toBe(null);
    expect(await h.bootstrap(v, { rendererViewState: 'invalid' })).toBe(null);
  } finally { canvas.dispose(); v.plugin.dispose(); }
});
