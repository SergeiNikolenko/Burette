import { afterAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { PluginContext } from '@molstar/plugin';
import { DefaultPluginSpec } from '@molstar/plugin/default-spec';
import { StructureElement } from '@molstar/model/model/structure';
import { StateTransforms } from '@molstar/viewer/state-transforms';
import { setCanvasModule } from '@molstar/graphics/geo/geometry/text/font-atlas';
import { BuretteGeometry } from '../scripts/molstar-geometry.js';

const browser = new Window(), previous = new Map();
Object.assign(browser, { setImmediate, clearImmediate });
for (const [key, value] of Object.entries({ window: browser, document: browser.document })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
afterAll(async () => {
  await browser.happyDOM.close();
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
});
setCanvasModule({ createCanvas: () => ({ getContext: () => ({ measureText: () => ({ width: 12 }), clearRect() {}, fillText() {},
  getImageData: (_x, _y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
}) }) });
const xyz = '\uFEFF4\r\nExact XYZ\r\nH 0 0 0\r\nN 1 0 0\r\nC 1 1 0\r\nO 1 1 1\r\n';
const target = '5\nNew XYZ\nC 1 1 0\nH 0 0 0\nO 1 1 1\nN 1 0 0\nHe 2 2 2\n';
const digest = text => createHash('sha256').update(text).digest('hex');
let duringDigest;
const scope = { molstar: { BuretteGeometry, lib: { structure: { StructureElement } } } };
for (const name of ['scene-file-actions', 'measurement-coordinate']) vm.runInNewContext(
  readFileSync(new URL(`../PreviewExtension/Web/${name}.js`, import.meta.url), 'utf8'),
  { window: scope, TextEncoder, TextDecoder, Uint8Array, Float64Array, File, crypto: { subtle: { digest: async (...args) => {
    const callback = duringDigest; duringDigest = undefined; await callback?.(); return crypto.subtle.digest(...args);
  } } } });
const science = scope.BuretteSceneFiles.science, runtime = scope.BuretteMeasurementCoordinate;
async function viewer(text = xyz) {
  const plugin = new PluginContext(DefaultPluginSpec()); await plugin.init();
  const raw = await plugin.builders.data.rawData({ data: text });
  const trajectory = await plugin.builders.structure.parseTrajectory(raw, 'xyz');
  await plugin.builders.structure.hierarchy.applyPreset(trajectory, 'default', { representationPreset: 'empty' });
  const root = plugin.managers.structure.hierarchy.current.structures[0].cell.obj.data;
  const loci = sources => StructureElement.Loci(root, root.units.map(unit => ({ unit,
    indices: Int32Array.from(Array.from(unit.elements, (element, index) => sources.includes(unit.model.atomicHierarchy.atomSourceIndex.value(element)) ? index : -1).filter(index => index >= 0)),
  })).filter(group => group.indices.length));
  return { plugin, raw, trajectory, root, loci };
}
const captured = value => runtime.capture(value, science, { sourceFormat: 'xyz', lease: BuretteGeometry.binding(value.plugin).lease });
const transfer = value => ({ version: 1, sourceFormat: value.sourceFormat, targetSourceSha256: value.sourceSha256, atomCount: value.atomCount, items: value.items, group: value.group });
const measurements = value => [...value.plugin.state.data.cells.values()].filter(cell =>
  String(cell.transform.transformer?.id).includes('structure-selections-') && ['Distance', 'Angle', 'Dihedral', 'Label', 'Orientation', 'Plane'].includes(cell.obj?.label));

test('XYZ transfer rebuilds all six measurements for explicit reordered source atoms with exact styles, groups and hidden flags', async () => {
  const before = await viewer(), after = await viewer(target);
  try {
    const m = before.plugin.managers.structure.measurement, l = before.loci;
    const results = [
      await m.addDistance(l([2]), l([0]), { visualParams: { customText: 'Distance 漢字', visuals: ['lines'], lineSizeAttenuation: false }, reprTags: ['measurement-order-label'] }),
      await m.addAngle(l([0]), l([1]), l([2]), { visualParams: { arcScale: .45, sectorOpacity: .35 } }),
      await m.addDihedral(l([0]), l([1]), l([2]), l([3]), { visualParams: { dashLength: .07 } }),
      await m.addLabel(l([0, 2]), { visualParams: { tooltip: 'Centroid', attachment: 'top-left', tether: true } }),
      await m.addOrientation([l([0, 1, 2, 3])]), await m.addPlane([l([0, 1, 2, 3])]),
    ];
    await before.plugin.state.data.build().to(results[4].representation).update({ visuals: ['axes'], radiusScale: .6, scaleFactor: 1.3 }).commit();
    await before.plugin.state.data.build().to(results[5].representation).update({ variant: 'circle', radialSegments: 24,
      material: { metalness: .8, roughness: .15, bumpiness: 0 }, lod: [2, 20, .5] }).commit();
    results.forEach((result, index) => {
      before.plugin.state.data.updateCellState(result.selection.ref, { isCollapsed: index % 2 === 0 });
      before.plugin.state.data.updateCellState(result.representation.ref, { isHidden: index % 2 === 1 });
    });
    before.plugin.state.data.updateCellState(m.getGroup().ref, { isHidden: true, isCollapsed: true });
    const capture = await captured(before);
    expect([capture.sourceFormat, capture.sourceSha256, capture.atomCount]).toEqual(['xyz', digest(xyz), 4]);
    expect(capture.items.map(item => item.kind)).toEqual(['Distance', 'Angle', 'Dihedral', 'Label', 'Orientation', 'Plane']);
    // Exact new→old provenance from the host edit: [2,0,3,1,-1]. No coordinates or element matching.
    const oldToNew = [1, 3, 0, 2];
    const value = { ...transfer(capture), targetSourceSha256: digest(target), atomCount: 5,
      items: capture.items.map(item => ({ ...item, points: item.points.map(point => point.map(old => oldToNew[old]).sort((a, b) => a - b)) })) };
    await runtime.restore(after, value, science);
    expect(transfer(await captured(after))).toEqual(value);
    expect(measurements(after).map(cell => [cell.obj.label, cell.transform.params])).toEqual(measurements(before).map(cell => [cell.obj.label, cell.transform.params]));
    await expect(runtime.restore(after, value, science)).rejects.toThrow('already has measurements');
    await expect(runtime.describe(before, [measurements(before)[0]], science)).rejects.toThrow('MOL or SDF');
  } finally { before.plugin.dispose(); after.plugin.dispose(); }
}, 15_000);

test('explicit XYZ capture requires its retained lease and rechecks ownership or source changes during hashing', async () => {
  const v = await viewer();
  try {
    for (const options of [{}, { sourceFormat: 'xyz' }, { sourceFormat: 'foreign', lease: 'x' }, { sourceFormat: 'xyz', lease: '' }]) {
      await expect(runtime.capture(v, science, options)).rejects.toThrow('current Geometry receipt');
    }
    const binding = BuretteGeometry.binding(v.plugin);
    await expect(runtime.capture(v, science, { sourceFormat: 'xyz', lease: 'foreign' })).rejects.toThrow('changed');
    // Changing coordinates is an accepted same-owner edit, but old text cannot be hashed for it.
    duringDigest = () => BuretteGeometry.update(v.plugin, xyz.replace('N 1 0 0', 'N 1.1 0 0'), BuretteGeometry.capture(v.plugin, () => true, binding.lease));
    await expect(runtime.capture(v, science, { sourceFormat: 'xyz', lease: binding.lease })).rejects.toThrow('source changed');
    const current = BuretteGeometry.binding(v.plugin);
    await v.plugin.state.data.build().toRoot().apply(StateTransforms.Data.RawData, { data: 'native action' }).commit({ canUndo: 'Native action' });
    await BuretteGeometry.update(v.plugin, xyz.replace('N 1 0 0', 'N 1.2 0 0'), BuretteGeometry.capture(v.plugin, () => true, current.lease));
    duringDigest = () => v.plugin.runTask(v.plugin.state.data.undo());
    await expect(runtime.capture(v, science, { sourceFormat: 'xyz', lease: current.lease })).rejects.toThrow('changed');
  } finally { duringDigest = undefined; v.plugin.dispose(); }
});

test('invalid transfers and unread-model replacement during hash leave the candidate without measurements', async () => {
  const before = await viewer(), after = await viewer();
  try {
    await before.plugin.managers.structure.measurement.addDistance(before.loci([0]), before.loci([1]));
    const valid = transfer(await captured(before)), first = valid.items[0];
    const invalid = [
      { ...valid, sourceFormat: 'unknown' }, { ...valid, targetSourceSha256: '0'.repeat(64) }, { ...valid, atomCount: 3 }, { ...valid, atomCount: 257 },
      { ...valid, items: [first, { ...first, points: [[0, 0], [1]] }] },
      { ...valid, items: [first, { ...first, params: { material: { roughness: NaN } } }] },
      { ...valid, items: Array.from({ length: 33 }, () => first) },
      { ...valid, items: Array.from({ length: 3 }, () => ({ ...first, params: { customText: '漢'.repeat(1024) } })) },
    ];
    for (const value of invalid) {
      await expect(runtime.restore(after, value, science)).rejects.toThrow(); expect(measurements(after)).toHaveLength(0);
    }
    const tooManyIndices = { ...valid, atomCount: 256, items: [{ ...first, kind: 'Orientation',
      points: Array.from({ length: 5 }, () => Array.from({ length: 256 }, (_, index) => index)) }] };
    await expect(runtime.restore(after, tooManyIndices, science)).rejects.toThrow('too many measurement atoms');
    expect(measurements(after)).toHaveLength(0);
    duringDigest = () => after.plugin.state.data.build().to(after.raw).update({ data: xyz.replace('Exact XYZ', 'Replacement XYZ') }).commit();
    await expect(runtime.restore(after, valid, science)).rejects.toThrow('changed');
    expect(measurements(after)).toHaveLength(0);
  } finally { duringDigest = undefined; before.plugin.dispose(); after.plugin.dispose(); }
});

test('XYZ admission is explicit and refuses actual oversize or multi-frame models', async () => {
  const single = await viewer();
  const oversized = await viewer('257\nToo many atoms\n' + Array.from({ length: 257 }, (_, i) => `C ${i * 1.5} 0 0`).join('\n') + '\n');
  const multi = await viewer(xyz + xyz.replace(/^\uFEFF/u, ''));
  try {
    await expect(runtime.capture(single, science)).rejects.toThrow();
    await expect(runtime.capture(single, science, { sourceFormat: 'xyz', lease: 'x'.repeat(129) })).rejects.toThrow('current Geometry receipt');
    await expect(captured(oversized)).rejects.toThrow('up to 256 atoms');
    await expect(runtime.capture(multi, science, { sourceFormat: 'xyz', lease: 'old' })).rejects.toThrow('single XYZ frame');
    expect(measurements(single)).toHaveLength(0); expect(measurements(oversized)).toHaveLength(0); expect(measurements(multi)).toHaveLength(0);
  } finally { single.plugin.dispose(); oversized.plugin.dispose(); multi.plugin.dispose(); }
});

test('all six native measurement kinds retain every state flag and legacy two-flag payloads remain valid', async () => {
  const before = await viewer(), after = await viewer(target), legacy = await viewer(target);
  const names = ['isHidden', 'isCollapsed', 'isLocked', 'isGhost'];
  const state = mask => Object.fromEntries(names.map((key, bit) => [key, Boolean(mask & (1 << bit))]));
  try {
    const m = before.plugin.managers.structure.measurement, l = before.loci;
    const results = [await m.addDistance(l([0]), l([1])), await m.addAngle(l([0]), l([1]), l([2])),
      await m.addDihedral(l([0]), l([1]), l([2]), l([3])), await m.addLabel(l([0, 2])),
      await m.addOrientation([l([0, 1, 2, 3])]), await m.addPlane([l([0, 1, 2, 3])])];
    const expected = results.map((result, index) => {
      const selection = state((5 + index * 3) % 16), representation = state(15 - (5 + index * 3) % 16);
      before.plugin.state.data.updateCellState(result.selection.ref, selection);
      before.plugin.state.data.updateCellState(result.representation.ref, representation);
      return { selection, representation };
    });
    before.plugin.state.data.updateCellState(m.getGroup().ref, state(15));
    const snapshot = before.plugin.state.data.getSnapshot(), capture = await captured(before);
    expect(before.plugin.state.data.getSnapshot()).toEqual(snapshot);
    expect(capture.items.map(({ selection, representation }) => ({ selection, representation }))).toEqual(expected);
    expect(capture.group).toEqual(state(15));
    const oldToNew = [1, 3, 0, 2];
    const value = { ...transfer(capture), targetSourceSha256: digest(target), atomCount: 5,
      items: capture.items.map(item => ({ ...item, points: item.points.map(point => point.map(old => oldToNew[old]).sort((a, b) => a - b)) })) };
    await runtime.restore(after, value, science);
    expect(transfer(await captured(after))).toEqual(value);
    const native = measurements(after).map(cell => ({
      selection: Object.fromEntries(names.map(key => [key, Boolean(after.plugin.state.data.cells.get(cell.transform.parent).state[key])])),
      representation: Object.fromEntries(names.map(key => [key, Boolean(cell.state[key])])),
    }));
    expect(native).toEqual(expected);
    expect(Object.fromEntries(names.map(key => [key, Boolean(after.plugin.state.data.cells.get(after.plugin.managers.structure.measurement.getGroup().ref).state[key])]))).toEqual(state(15));
    const oldFlags = value => ({ isHidden: value.isHidden, isCollapsed: value.isCollapsed });
    const oldPayload = { ...value, group: oldFlags(value.group), items: value.items.map(item => ({ ...item,
      selection: oldFlags(item.selection), representation: oldFlags(item.representation) })) };
    await runtime.restore(legacy, oldPayload, science);
    expect(transfer(await captured(legacy))).toEqual({ ...oldPayload, group: { ...oldPayload.group, isLocked: false, isGhost: false },
      items: oldPayload.items.map(item => ({ ...item, selection: { ...item.selection, isLocked: false, isGhost: false },
        representation: { ...item.representation, isLocked: false, isGhost: false } })) });
  } finally { before.plugin.dispose(); after.plugin.dispose(); legacy.plugin.dispose(); }
});

test('unknown or nonboolean native/transfer state flags refuse before hashing or restoring any item', async () => {
  const before = await viewer(), after = await viewer();
  try {
    const result = await before.plugin.managers.structure.measurement.addDistance(before.loci([0]), before.loci([1]));
    const valid = transfer(await captured(before)), first = valid.items[0], snapshot = after.plugin.state.data.getSnapshot();
    const malformed = [undefined, null, [], false, 'true', 0, { isHidden: 1 }, { isCollapsed: null },
      { isLocked: 'true' }, { isGhost: 1 }, { foreign: false }];
    let hashes = 0;
    for (const state of malformed) for (const area of ['group', 'selection', 'representation']) {
      const value = area === 'group' ? { ...valid, group: state }
        : { ...valid, items: [first, { ...first, [area]: state }] };
      duringDigest = () => { hashes++; };
      await expect(runtime.restore(after, value, science)).rejects.toThrow('state flags');
      expect(after.plugin.state.data.getSnapshot()).toEqual(snapshot);
    }
    duringDigest = undefined; expect(hashes).toBe(0);
    for (const ref of [result.selection.ref, result.representation.ref, before.plugin.managers.structure.measurement.getGroup().ref]) {
      const cell = before.plugin.state.data.cells.get(ref);
      before.plugin.state.data.updateCellState(ref, { foreignFlag: true });
      await expect(captured(before)).rejects.toThrow('state flags'); delete cell.state.foreignFlag;
      before.plugin.state.data.updateCellState(ref, { isGhost: 'invalid' });
      await expect(captured(before)).rejects.toThrow('state flags');
      before.plugin.state.data.updateCellState(ref, { isGhost: false });
    }
  } finally { duringDigest = undefined; before.plugin.dispose(); after.plugin.dispose(); }
});
