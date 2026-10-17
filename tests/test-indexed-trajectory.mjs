import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Task } from 'molstar/lib/mol-task/index.js';
import { Coordinates, Time } from 'molstar/lib/mol-model/structure/coordinates.js';
import { Cell } from 'molstar/lib/mol-math/geometry/spacegroup/cell.js';
import { Vec3 } from 'molstar/lib/mol-math/linear-algebra.js';
import { parseXtc } from 'molstar/lib/mol-io/reader/xtc/parser.js';

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

const failedPlugin = { builders: { data: { rawData: async () => { throw new Error('model failed'); } } } };
await assert.rejects(BuretteIndexedTrajectory.load({ plugin: failedPlugin }, { coordinateEntry: { indexedTrajectory: descriptor, data: dcdFrame() }, modelEntry: {} }, {}, () => {}), /model failed/);
assert.equal(readers.has(failedPlugin), false, 'failed attachment releases its initial bytes and callback');
console.log('Indexed trajectory: DCD/TRR/compressed XTC decoding, byte/frame cache bounds, eviction, overlap, cancellation, revision guards, reader disposal and same-source snapshot restore passed');
