import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { Task } from 'molstar/lib/mol-task/index.js';
import { Coordinates, Time } from 'molstar/lib/mol-model/structure/coordinates.js';
import { Cell } from 'molstar/lib/mol-math/geometry/spacegroup/cell.js';
import { Vec3 } from 'molstar/lib/mol-math/linear-algebra.js';
import { parseXtc } from 'molstar/lib/mol-io/reader/xtc/parser.js';
import { StateTransformer } from 'molstar/lib/mol-state/transformer.js';
import '../scripts/molstar-indexed-trajectory.js';

assert.equal(StateTransformer.get('ms-plugin.burette-indexed-trajectory').id, 'ms-plugin.burette-indexed-trajectory',
  'the ordinary viewer entry registers the saved transform when its bundle loads');

// Exercise the real adapter's private decoder/cache with actual Mol* coordinate
// types. Model construction is isolated so the tests need no WebGL context.
const source = readFileSync(new URL('../scripts/molstar-indexed-trajectory.js', import.meta.url), 'utf8')
  .replace(/^import .*;$/gm, '').replace('export const BuretteIndexedTrajectory', 'const BuretteIndexedTrajectory');
const observedCaches = [];
class ObservedMap extends Map {
  constructor(entries) { super(entries); if (entries) observedCaches.push(this); }
}
class TrajectoryObject { constructor(data) { this.data = data; } }
const context = vm.createContext({ Task, Coordinates, Time, Cell, Vec3, parseXtc, DataView, Float32Array, AbortController, Map: ObservedMap,
  PluginStateTransform: { BuiltIn: () => definition => definition }, PluginStateObject: { Root: {}, Molecule: { Trajectory: TrajectoryObject, Topology: { type: 'topology' } } },
  PD: { Text: () => ({}), Value: () => ({}) },
  Model: { trajectoryFromModelAndCoordinates: (_template, coords) => ({ representative: { frame: coords.frames[0] } }), TrajectoryInfo: { set: (model, info) => { model.info = info; } } }
});
vm.runInContext(`${source}\nglobalThis.adapter = { decodeFrame, createTrajectory, readers, IndexedTrajectory, BuretteIndexedTrajectory };`, context);
const { decodeFrame, createTrajectory, readers, IndexedTrajectory, BuretteIndexedTrajectory } = context.adapter;
const ctx = { isSynchronous: true, update: async () => {} };

function dcdFrame(index = 0, count = 2) {
  const bytes = new Uint8Array(252 + 3 * (count * 4 + 8)), view = new DataView(bytes.buffer);
  for (const [offset, value] of [[0, 84], [8, 1], [16, 1], [48, 1], [84, 24], [88, 84], [92, 84], [96, 1], [180, 84], [184, 4], [188, count], [192, 4], [196, 48], [248, 48]]) view.setUint32(offset, value, true);
  bytes.set(new TextEncoder().encode('CORD'), 4);
  [10, 0.125, 12, 0.25, 0.5, 14].forEach((value, i) => view.setFloat64(200 + i * 8, value, true));
  for (let axis = 0, offset = 252; axis < 3; axis++, offset += count * 4 + 8) {
    view.setUint32(offset, count * 4, true); view.setUint32(offset + count * 4 + 4, count * 4, true);
    new Float32Array(bytes.buffer, offset + 4, count).fill(index + axis);
    if (count > 1) view.setFloat32(offset + 8, index + axis + 0.5, true);
  }
  return bytes;
}

const dcd = await decodeFrame('dcd', dcdFrame(), 12.25, ctx);
assert.deepEqual(Array.from(dcd.x), [0, 0.5]);
assert.deepEqual(Array.from(dcd.y), [1, 1.5]);
assert.deepEqual(Array.from(dcd.z), [2, 2.5]);
assert.equal(dcd.time.value, 12.25); assert.equal(dcd.time.unit, 'ps');
assert.deepEqual(Array.from(dcd.cell.size), [10, 12, 14]);
for (const [i, cosine] of [0.5, 0.25, 0.125].entries()) assert.ok(Math.abs(dcd.cell.anglesInRadians[i] - Math.acos(cosine)) < 1e-12);
const desmond = await decodeFrame('dcd', dcdFrame(), 8, ctx, [20, 0, 0, 0, 30, 0, 0, 0, 40]);
assert.deepEqual(Array.from(desmond.cell.size), [20, 30, 40]);

function trrFrame(precision, box) {
  const version = new TextEncoder().encode('GMX_trn_file');
  const header = 12 + version.length, boxBytes = box ? precision * 9 : 0;
  const bytes = new Uint8Array(header + 52 + 2 * precision + boxBytes + 3 * precision);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 1993); view.setUint32(4, 13); view.setUint32(8, version.length); bytes.set(version, 12);
  view.setUint32(header + 8, boxBytes); view.setUint32(header + 28, precision * 3); view.setUint32(header + 40, 1);
  const float = (offset, value) => precision === 8 ? view.setFloat64(offset, value) : view.setFloat32(offset, value);
  float(header + 52, 2.75);
  let offset = header + 52 + 2 * precision;
  if (box) { [1, 0, 0, 0, 2, 0, 0, 0, 3].forEach((value, i) => float(offset + i * precision, value)); offset += boxBytes; }
  [0.125, -0.25, 1.5].forEach((value, i) => float(offset + i * precision, value));
  return bytes;
}
for (const precision of [4, 8]) for (const box of [true, false]) {
  const frame = await decodeFrame('trr', trrFrame(precision, box), null, ctx);
  assert.deepEqual([frame.x[0], frame.y[0], frame.z[0]], [1.25, -2.5, 15]);
  assert.equal(frame.time.value, 2.75); assert.equal(frame.time.unit, 'ps');
  assert.deepEqual(frame.cell ? Array.from(frame.cell.size) : undefined, box ? [10, 20, 30] : undefined);
}

// Independently written by MDAnalysis/XDR, not by the adapter under test.
// 48 atoms force the compressed XTC path (>9), including negative positions
// and a triclinic cell. XTC precision=3 quantizes at 0.01 Angstrom.
const xtc = await decodeFrame('xtc', new Uint8Array(readFileSync(new URL('./fixtures/trajectory/compressed.xtc', import.meta.url))), null, ctx);
assert.equal(xtc.elementCount, 48);
for (let atom = 0; atom < 48; atom++) {
  const expected = [atom * 0.03125, -atom * 0.0625, (atom % 7) * 0.125];
  [xtc.x[atom], xtc.y[atom], xtc.z[atom]].forEach((value, axis) => assert.ok(Math.abs(value - expected[axis]) <= 0.0051, `XTC atom ${atom}, axis ${axis}`));
}
assert.equal(xtc.time.value, 2.75); assert.equal(xtc.time.unit, 'ps');
[31, 37, 43].forEach((length, axis) => assert.ok(Math.abs(xtc.cell.size[axis] - length) < 1e-5));
[70, 75, 80].forEach((degrees, axis) => assert.ok(Math.abs(xtc.cell.anglesInRadians[axis] * 180 / Math.PI - degrees) < 1e-5));

// The trajectory has a million logical frames; cache/prefetch retains only a
// handful. Random seeking must preserve the requested original frame index.
const reads = [], aborted = [];
const request = async (index, signal, validateOnly) => {
  if (validateOnly) return { valid: true };
  reads.push(index); signal?.addEventListener('abort', () => aborted.push(index));
  await Promise.resolve();
  return { bytes: dcdFrame(index), timePs: index * 2.5 };
};
const trajectory = createTrajectory({}, { frameCount: 1_000_000, atomCount: 2, format: 'dcd' }, dcd, request);
for (const index of [999_999, 500_000, 7, 999_999]) {
  const model = await trajectory.getFrameAtIndex(index).run();
  assert.equal(model.frame.x[0], index);
  assert.equal(model.frame.time.value, index * 2.5);
  assert.deepEqual({ ...model.info }, { index, size: 1_000_000 });
}
assert.ok(reads.length <= 8, 'seek must not enumerate logical frames');
trajectory.dispose();
await assert.rejects(trajectory.getFrameAtIndex(0).run(), /unavailable/);
async function until(predicate) {
  for (let turn = 0; turn < 100; turn++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail('Controlled async operation did not reach the expected state.');
}
const cacheBytes = cache => [...cache.values()].reduce((total, frame) => total + frame.x.byteLength + frame.y.byteLength + frame.z.byteLength, 0);

// Observe real retained coordinate arrays, rather than inferring boundedness
// from a count of requests. Three frames and 32 MiB are independent limits.
const frameReads = [];
const frameBound = createTrajectory({}, { frameCount: 20, atomCount: 2, format: 'dcd' }, dcd, async (index, _signal, validateOnly) => {
  if (validateOnly) return { valid: true };
  frameReads.push(index); return { bytes: dcdFrame(index), timePs: index };
});
const frameCache = observedCaches.at(-1);
for (const index of [19, 10, 4, 0]) {
  await frameBound.getFrameAtIndex(index).run();
  await until(() => frameCache.has(Math.min(index + 1, 19)));
  assert.ok(frameCache.size <= 3);
  assert.ok(cacheBytes(frameCache) <= 32 * 1024 * 1024);
}
assert.equal(frameReads.filter(index => index === 0).length, 1, 'evicted first frame must be read again');
frameBound.dispose();
assert.equal(frameCache.size, 0, 'dispose releases cached coordinate arrays');

const largeCount = 1_000_000;
const largeFirst = await decodeFrame('dcd', dcdFrame(0, largeCount), 0, ctx);
const byteBound = createTrajectory({}, { frameCount: 10, atomCount: largeCount, format: 'dcd' }, largeFirst, async (index, _signal, validateOnly) =>
  validateOnly ? { valid: true } : { bytes: dcdFrame(index, largeCount), timePs: index });
const byteCache = observedCaches.at(-1);
for (const index of [9, 5, 6]) {
  await byteBound.getFrameAtIndex(index).run();
  assert.ok(cacheBytes(byteCache) <= 32 * 1024 * 1024);
  assert.ok(byteCache.size <= 2, 'three 12 MB coordinate frames must exceed the byte budget');
}
assert.equal(byteCache.size, 2);
byteBound.dispose();

let validates = 0;
const changed = createTrajectory({}, { frameCount: 2, atomCount: 2, format: 'dcd' }, dcd, async (_index, _signal, validateOnly) => {
  if (validateOnly) { validates++; throw new Error('Trajectory source changed'); }
  assert.fail('Cached frame validation must not reread coordinates.');
});
await assert.rejects(changed.getFrameAtIndex(0).run(), /source changed/);
assert.equal(validates, 1);
changed.dispose();

// Concurrent demand for the same frame is shared; distinct coordinate reads
// are serialized even when callers do not use the ordinary slider scheduler.
let demandReads = 0, activeReads = 0, maxReads = 0;
const overlapping = createTrajectory({}, { frameCount: 12, atomCount: 2, format: 'dcd' }, dcd, async (index, _signal, validateOnly) => {
  if (validateOnly) return { valid: true };
  demandReads++; activeReads++; maxReads = Math.max(maxReads, activeReads);
  await Promise.resolve(); activeReads--;
  return { bytes: dcdFrame(index), timePs: index };
});
const same = await Promise.all(Array.from({ length: 20 }, () => overlapping.getFrameAtIndex(11).run()));
assert.equal(demandReads, 1);
assert.ok(same.every(model => model.frame.x[0] === 11));
const distinct = await Promise.all([3, 6, 9].map(index => overlapping.getFrameAtIndex(index).run()));
assert.deepEqual(distinct.map(model => model.frame.x[0]), [3, 6, 9]);
assert.equal(maxReads, 1);
overlapping.dispose();

const controlledReads = new Map(), cancelled = [];
const controlled = createTrajectory({}, { frameCount: 100, atomCount: 2, format: 'dcd' }, dcd, (index, signal, validateOnly) => {
  if (validateOnly) return Promise.resolve({ valid: true });
  return new Promise((resolve, reject) => {
    controlledReads.set(index, { resolve: () => resolve({ bytes: dcdFrame(index), timePs: index }) });
    signal?.addEventListener('abort', () => { cancelled.push(index); reject(new Error('prefetch cancelled')); }, { once: true });
  });
});
const controlledCache = observedCaches.at(-1);
const ten = controlled.getFrameAtIndex(10).run();
await until(() => controlledReads.has(10)); controlledReads.get(10).resolve(); await ten;
await until(() => controlledReads.has(11));
const seventy = controlled.getFrameAtIndex(70).run();
await until(() => controlledReads.has(70));
assert.ok(cancelled.includes(11), 'distant seek cancels the pending speculative read');
controlledReads.get(70).resolve();
assert.equal((await seventy).frame.x[0], 70);
await until(() => controlledReads.has(71));
controlled.dispose();
assert.ok(cancelled.includes(71), 'dispose cancels the current speculative read');
assert.equal(controlledCache.size, 0);
await assert.rejects(controlled.getFrameAtIndex(70).run(), /unavailable/);

let finishLate;
const late = createTrajectory({}, { frameCount: 2, atomCount: 2, format: 'dcd' }, dcd,
  () => new Promise(resolve => { finishLate = () => resolve({ bytes: dcdFrame(1), timePs: 1 }); }));
const lateCache = observedCaches.at(-1);
const lateFrame = late.getFrameAtIndex(1).run();
await until(() => finishLate);
late.dispose(); finishLate();
await assert.rejects(lateFrame, error => error.isAborted === true);
assert.equal(lateCache.size, 0, 'an uncancellable native reply cannot refill a disposed cache');

const plugin = {}, descriptor = { indexKey: 'a', frameCount: 3, atomCount: 2, format: 'dcd', firstTimePs: 0 };
const binding = key => ({ indexKey: key, firstBytes: dcdFrame(), request: async () => ({ bytes: dcdFrame(), timePs: 0 }) });
const apply = current => IndexedTrajectory.apply({ params: { modelRef: 'model', descriptor: current }, dependencies: { model: { type: 'model', data: {} } } }, plugin).run();
const oldReader = binding('a'); readers.set(plugin, oldReader);
const oldObject = await apply(descriptor);
assert.equal(oldReader.firstBytes, undefined, 'initial encoded frame is released after decoding');
const newReader = binding('b'); readers.set(plugin, newReader);
IndexedTrajectory.dispose({ b: oldObject });
assert.equal(readers.get(plugin), newReader, 'disposing an old attachment must not remove the newer reader');
const newObject = await apply({ ...descriptor, indexKey: 'b' });
IndexedTrajectory.dispose({ b: newObject });
assert.equal(readers.has(plugin), false, 'disposing the owning attachment releases the WeakMap binding');

readers.set(plugin, binding('a'));
const sameOld = await apply(descriptor), sameNew = await apply(descriptor);
const sameBinding = readers.get(plugin);
IndexedTrajectory.dispose({ b: sameOld });
assert.equal(readers.get(plugin), sameBinding, 'same-source replacement also has independent binding ownership');
IndexedTrajectory.dispose({ b: sameNew });
assert.equal(readers.has(plugin), false);

// Run the real viewer bridge guard with only native I/O substituted. Undo and
// MOLX recreate transforms after disposal, so no stale reader may be required.
const viewerSource = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const bridgeStart = viewerSource.indexOf('  function requestIndexedTrajectoryFrameFromNative(');
const bridgeEnd = viewerSource.indexOf('\n  window.BuretteReadIndexedTrajectoryFrame', bridgeStart);
assert.ok(bridgeStart >= 0 && bridgeEnd > bridgeStart);
let nativeCalls = 0, revisionChanged = false;
context.window = context;
context.activeConfig = { docking: { ligands: [{ indexedTrajectory: descriptor }] } };
context.requestTrajectoryFrameFromNative = async (index, segment, _signal, validateOnly) => {
  nativeCalls++; assert.equal(segment, 0);
  if (revisionChanged) throw new Error('Trajectory source changed; reopen it.');
  return validateOnly ? { valid: true } : { bytes: dcdFrame(index), timePs: index * 2.5 };
};
vm.runInContext(`${viewerSource.slice(bridgeStart, bridgeEnd)}\nglobalThis.BuretteReadIndexedTrajectoryFrame = requestIndexedTrajectoryFrameFromNative;`, context);
const restored = await apply(descriptor); // Old snapshots have no segmentIndex.
assert.equal(restored.data.representative.frame.x[0], 0);
assert.equal((await restored.data.getFrameAtIndex(2).run()).frame.x[0], 2);
IndexedTrajectory.dispose({ b: restored });
assert.equal(readers.has(plugin), false);
const readsBeforeWrongSource = nativeCalls;
await assert.rejects(apply({ ...descriptor, indexKey: 'b' }), /source is no longer open/);
assert.equal(nativeCalls, readsBeforeWrongSource, 'a different source snapshot must not read current source coordinates');
assert.equal(readers.has(plugin), false, 'failed rehydration does not retain its binding');
revisionChanged = true;
await assert.rejects(apply(descriptor), /source changed/);
assert.equal(readers.has(plugin), false, 'native revision rejection also releases the restore binding');
revisionChanged = false;
const restoredAgain = await apply({ ...descriptor, segmentIndex: 0 });
IndexedTrajectory.dispose({ b: restoredAgain });
assert.equal(readers.has(plugin), false, 'repeated valid restores remain disposable');

// A new scene runtime has no docking configuration. Its serialized descriptor
// must retain the bounded source binding and request the original full run.
const savedDescriptor = JSON.parse(JSON.stringify({ ...descriptor, frameCount: 1_000_000, source: { kind: 'file', path: '/data/original.dcd' } }));
context.activeConfig = { format: 'molx' };
let restoredRequest;
context.requestTrajectoryFrameFromNative = async (index, segment, _signal, validateOnly, restoredTrajectory) => {
  assert.equal(segment, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(restoredTrajectory)), savedDescriptor);
  restoredRequest = restoredTrajectory;
  if (revisionChanged) throw new Error('Trajectory source changed since this scene was saved');
  return validateOnly ? { valid: true } : { bytes: dcdFrame(index), timePs: index * 2.5 };
};
const newScene = await apply(savedDescriptor);
assert.equal(newScene.data.frameCount, 1_000_000);
assert.equal((await newScene.data.getFrameAtIndex(999_999).run()).frame.x[0], 999_999);
assert.equal(restoredRequest.source.path, '/data/original.dcd');
IndexedTrajectory.dispose({ b: newScene });
assert.equal(readers.has(plugin), false);
revisionChanged = true;
await assert.rejects(apply(savedDescriptor), /source changed since this scene was saved/);
assert.equal(readers.has(plugin), false);
revisionChanged = false;
context.activeConfig = { format: 'molj' };
const jsonScene = await apply(savedDescriptor);
IndexedTrajectory.dispose({ b: jsonScene });
context.activeConfig = { format: 'pdb' };
await assert.rejects(apply(savedDescriptor), /source is no longer open/);
context.activeConfig = { format: 'molx' };
await assert.rejects(apply(descriptor), /source is no longer open/);

const failedPlugin = { builders: { data: { rawData: async () => { throw new Error('model failed'); } } } };
await assert.rejects(BuretteIndexedTrajectory.load({ plugin: failedPlugin }, { coordinateEntry: { indexedTrajectory: descriptor, data: dcdFrame() }, modelEntry: {} }, {}, () => {}), /model failed/);
assert.equal(readers.has(failedPlugin), false, 'failed attachment releases its initial bytes and callback');

// Ordinary archives use Mol*'s full archive loader so embedded assets survive;
// binary ZIP bytes must never pass through the JSON-only MOLJ loader.
const prepareStart = viewerSource.indexOf('  function structureDataForMolstar(');
const prepareEnd = viewerSource.indexOf('    if (isMolViewSpecFormat(normalized))', prepareStart);
const loadStart = viewerSource.indexOf('  async function loadPreparedStructure(');
const loadEnd = viewerSource.indexOf('    cancelScheduledMolstarWaterRepresentation();', loadStart);
const archiveBytes = new Uint8Array([80, 75, 3, 4]);
const archiveContext = vm.createContext({ File, Uint8Array,
  normalizeFormat: value => value, structureSceneEntriesFromConfig: () => [], rawStructureData: () => archiveBytes,
  activeMolstarPrepared: null, activeDockingPrepared: null, installDockingPoseControls: () => {},
  nativeTrajectoryModelTransform: () => null,
});
vm.runInContext(`${viewerSource.slice(prepareStart, prepareEnd)}}\n${viewerSource.slice(loadStart, loadEnd)}}\nglobalThis.prepare = structureDataForMolstar; globalThis.load = loadPreparedStructure;`, archiveContext);
const preparedArchive = archiveContext.prepare({ format: 'molx', label: 'saved scene' });
assert.equal(preparedArchive.kind, 'session');
let loadedArchive;
await archiveContext.load({ plugin: { managers: {
  snapshot: { open: async file => { loadedArchive = file; }, state: { current: 'saved' },
    getEntry: id => { assert.equal(id, 'saved'); return { snapshot: { camera: { current: { radius: 5 } } } }; },
    setStateSnapshot: () => assert.fail('MOLX must load its archive assets') },
  camera: { reset: () => assert.fail('The saved scene camera must survive') },
} } }, preparedArchive);
assert.equal(loadedArchive.name, 'scene.molx');
assert.deepEqual(new Uint8Array(await loadedArchive.arrayBuffer()), archiveBytes);
assert.equal(preparedArchive.hasSessionCamera, true);

// Run the real frame-control installer against a restored indexed trajectory.
// An authored nonzero modelIndex must beat stale per-document storage/playback;
// subsequent agent and slider seeks must still read the requested source frame.
const controlsWindow = new Window();
const controlsDocument = controlsWindow.document;
const playable = await apply(savedDescriptor);
const authoredModel = await playable.data.getFrameAtIndex(7).run();
let shownModel = authoredModel;
const modelCell = { transform: { ref: 'model', parent: 'trajectory', params: { modelIndex: 7 }, transformer: { id: 'ms-plugin.model-from-trajectory' } } };
const changedListeners = new Set(), modelWrites = [];
const controlsViewer = { plugin: {
  state: {
    data: { cells: new Map([['trajectory', { obj: { data: playable.data } }], ['model', modelCell]]),
      events: { changed: { subscribe: fn => { changedListeners.add(fn); return { unsubscribe: () => changedListeners.delete(fn) }; } } } },
    updateTransform: async (_state, ref, params) => {
      assert.equal(ref, 'model');
      shownModel = await playable.data.getFrameAtIndex(params.modelIndex).run();
      modelCell.transform.params = params;
      modelWrites.push(params.modelIndex);
      changedListeners.forEach(fn => fn());
    },
  },
  managers: { structure: { hierarchy: { selection: { structures: [{ model: { cell: modelCell } }] } } },
    snapshot: { open: async () => {}, state: { current: 'saved' }, getEntry: () => ({ snapshot: { camera: { current: { radius: 5 } } } }) },
    camera: { reset: () => assert.fail('Installing restored frame controls must preserve the camera') } },
} };
controlsWindow.sessionStorage.setItem('burette.trajectoryControl.saved_scene', '42');
const controlContext = vm.createContext({
  syncSceneTreeClearance: () => {},
  trajectoryControlIndices: new Map(), window: controlsWindow, document: controlsDocument, File, console, sessionStorage: controlsWindow.sessionStorage,
  activeViewer: controlsViewer, activeConfig: { documentId: 'saved_scene', activeModel: 0 }, activeMolstarPrepared: null, activeDockingPrepared: null,
  activeStructureAlignmentControl: null, activeStructurePoseSetter: null, activeSdfCollectionPoseSetter: null, activeTrajectoryPlaybackControl: null,
  dockingPoseKeydownDisposer: null, dockingPoseControlsDisposer: null, pendingTrajectoryPlaybackRestore: { frameIndex: 40, playing: true, fps: 50 },
  activeSdfPoseMode: 'single', trajectorySmoothingState: null, molstarStructureFocusSerial: 0, hostViewerVisible: true,
  dockingPinnedPoseState: { key: '', indices: new Set() },
  structureOverlayAvailable: () => false, structureOverlayToggleAvailable: () => false, structureSceneStoryAvailable: () => false,
  sceneTreeIconElement: () => controlsDocument.createElement('span'), APP_ICON_DATA: {}, formatTrajectoryFps: String, readTrajectoryLoopFps: () => 20,
  postHostMessage: () => {}, updateViewportAnimateState: () => {}, xyzSingleFrameSceneActive: () => false,
  trajectoryPoseLabel: (prepared, label, index) => `${label} ${index + 1} / ${prepared.poseCount}`,
  restoreDockingPoseControlsPosition: () => {}, installDockingPoseInteractionIsolation: () => {}, installDockingPoseHoverSuppression: () => {}, initDockingPoseControlsDrag: () => {},
  clearMolstarTrajectoryHover: () => {}, afterNativeTrajectoryPaint: () => Promise.resolve(), readNativeTrajectoryPositionFromDom: () => null,
});
const controlFunctions = ['nativeTrajectoryFrameCount', 'nativeTrajectoryModelTransform', 'readNativeTrajectoryPosition', 'readTrajectoryControlIndex',
  'trajectoryControlStorageKey', 'writeTrajectoryControlIndex', 'setNativeTrajectoryPoseDirect', 'setNativeTrajectoryPose', 'installNativeTrajectoryPoseSync', 'notifyChemicalSpaceMolecule', 'notifyDockingPoseChanged', 'dockingPinnedPoseIndices', 'installDockingPoseControls'];
const extractedControls = controlFunctions.map(name => {
  const fn = viewerSource.match(new RegExp(`\\n  (?:async )?function ${name}\\([\\s\\S]*?\\n  \\}`, 'u'))?.[0];
  assert.ok(fn, name);
  return fn;
}).join('\n');
vm.runInContext(`${extractedControls}\n${viewerSource.slice(loadStart, loadEnd)}}\nglobalThis.load = loadPreparedStructure;`, controlContext);
const restoredControls = { kind: 'session', format: 'molx', data: archiveBytes };
await controlContext.load(controlsViewer, restoredControls);
assert.deepEqual([restoredControls.poseCount, restoredControls.activePose, restoredControls.nativeTrajectoryControls, restoredControls.controlLabel], [1_000_000, 7, true, 'Frame']);
assert.deepEqual(modelWrites, [], 'installing controls must not rewrite the authored frame');
assert.equal(controlContext.pendingTrajectoryPlaybackRestore, null);
assert.equal(typeof controlContext.activeStructurePoseSetter, 'function');
const frameSlider = controlsDocument.querySelector('.buret-docking-pose-slider');
assert.equal(frameSlider.value, '8');
assert.equal(frameSlider.max, '1000000');
await controlContext.activeStructurePoseSetter(999_999);
assert.equal(shownModel.frame.x[0], 999_999);
assert.equal(frameSlider.value, '1000000');
frameSlider.value = '10';
frameSlider.dispatchEvent(new controlsWindow.Event('change'));
await until(() => modelCell.transform.params.modelIndex === 9);
assert.equal(shownModel.frame.x[0], 9);
assert.equal(controlContext.readTrajectoryControlIndex(controlContext.activeConfig, restoredControls, restoredControls.poseCount), 9);
controlContext.dockingPoseControlsDisposer();
controlContext.dockingPoseKeydownDisposer();
IndexedTrajectory.dispose({ b: playable });
await controlsWindow.happyDOM.abort();
console.log('Indexed trajectory: DCD/TRR/compressed XTC decoding, cache bounds, cancellation, revision guards, disposal and same/new-runtime snapshot restoration passed');
