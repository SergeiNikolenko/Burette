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
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
  await browser.happyDOM.close();
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
const transfer = value => ({ version: 1, sourceFormat: value.sourceFormat, targetSourceSha256: value.sourceSha256, atomCount: value.atomCount, items: value.items, group: value.group, ...(value.groupParams ? { groupParams: value.groupParams } : {}) });
const measurements = value => [...value.plugin.state.data.cells.values()].filter(cell =>
  String(cell.transform.transformer?.id).includes('structure-selections-') && ['Distance', 'Angle', 'Dihedral', 'Label', 'Orientation', 'Plane'].includes(cell.obj?.label));

const nativeFlags = { isHidden: true, isCollapsed: true, isLocked: true, isGhost: true };
const groups = v => [...v.plugin.state.data.cells.values()].filter(cell => cell.transform.tags?.includes('measurement-group'));
const metadata = { label: 'Authored group 漢字', description: 'Exact group description\r\nwith UTF-8 β' };
const rename = async (v, params) => v.plugin.state.data.build().to(v.plugin.managers.structure.measurement.getGroup().ref).update(params).commit();

test('native group label/description and all flags survive restoration, baseline ACK and recapture', async () => {
  const before = await viewer(), after = await viewer();
  try {
    const distance = await before.plugin.managers.structure.measurement.addDistance(before.loci([0]), before.loci([2]));
    await rename(before, metadata);
    for (const ref of [distance.selection.ref, distance.representation.ref, groups(before)[0].transform.ref]) before.plugin.state.data.updateCellState(ref, nativeFlags);
    const snapshot = before.plugin.state.data.getSnapshot(), capture = await captured(before);
    expect(before.plugin.state.data.getSnapshot()).toEqual(snapshot); expect(capture.groupParams).toEqual(metadata);
    await runtime.restore(after, transfer(capture), science);
    const actual = groups(after)[0];
    expect([actual.obj.label, actual.obj.description, actual.params.values, actual.state, actual.transform.state, after.plugin.state.data.tree.transforms.get(actual.transform.ref).state])
      .toEqual([metadata.label, metadata.description, metadata, nativeFlags, nativeFlags, nativeFlags]);
    const binding = BuretteGeometry.binding(after.plugin);
    await BuretteGeometry.update(after.plugin, binding.text, BuretteGeometry.capture(after.plugin, () => true, binding.lease));
    expect(transfer(await captured(after))).toEqual(transfer(capture));
  } finally { before.plugin.dispose(); after.plugin.dispose(); }
});

test('an actual empty group retains metadata and flags while absent legacy group metadata creates no container', async () => {
  const before = await viewer(), after = await viewer(), legacy = await viewer(), noDescription = await viewer();
  try {
    const group = before.plugin.managers.structure.measurement.getGroup(); await group.update(metadata).commit();
    before.plugin.state.data.updateCellState(group.ref, nativeFlags);
    const capture = await captured(before); expect(capture.items).toHaveLength(0); expect(capture.groupParams).toEqual(metadata);
    await runtime.restore(after, transfer(capture), science);
    expect(groups(after)).toHaveLength(1); expect(measurements(after)).toHaveLength(0);
    expect(transfer(await captured(after))).toEqual(transfer(capture));
    const { groupParams: _params, ...old } = transfer(capture); await runtime.restore(legacy, old, science);
    expect(groups(legacy)).toHaveLength(0); expect((await captured(legacy)).groupParams).toBe(undefined);
    const labelOnly = { ...transfer(capture), groupParams: { label: 'No optional description' } };
    await runtime.restore(noDescription, labelOnly, science); expect(transfer(await captured(noDescription))).toEqual({ ...labelOnly, groupParams: { ...labelOnly.groupParams, description: '' } });
  } finally { before.plugin.dispose(); after.plugin.dispose(); legacy.plugin.dispose(); noDescription.plugin.dispose(); }
});

test('invalid group metadata and multiple/foreign native groups refuse before target mutation', async () => {
  const before = await viewer(), after = await viewer();
  try {
    await before.plugin.managers.structure.measurement.addDistance(before.loci([0]), before.loci([1]));
    const valid = transfer(await captured(before)), snapshot = after.plugin.state.data.getSnapshot();
    const invalid = [undefined, null, [], false, {}, { label: 1 }, { label: 'a', description: undefined }, { label: 'a', description: 1 },
      { label: 'a', foreign: true }, { label: 'x'.repeat(257) }, { label: 'a', description: 'x'.repeat(1025) },
      { label: 'a', description: '漢'.repeat(700) }];
    let hashes = 0;
    for (const groupParams of invalid) {
      duringDigest = () => { hashes++; };
      await expect(runtime.restore(after, { ...valid, groupParams }, science)).rejects.toThrow('group parameters');
      expect(after.plugin.state.data.getSnapshot()).toEqual(snapshot);
    }
    duringDigest = undefined; expect(hashes).toBe(0);
    const extra = await before.plugin.state.data.build().toRoot().apply(StateTransforms.Misc.CreateGroup, { label: 'Second group' }, { tags: ['measurement-group'] }).commit();
    await expect(captured(before)).rejects.toThrow('one native group');
    await before.plugin.state.data.build().delete(extra).commit();
    const foreign = await after.plugin.state.data.build().toRoot().apply(StateTransforms.Data.RawData, { data: 'foreign' }, { tags: ['measurement-group'] }).commit();
    await expect(captured(after)).rejects.toThrow('one native group');
    await expect(runtime.restore(after, valid, science)).rejects.toThrow('one native group');
    await after.plugin.state.data.build().delete(foreign).commit();
    await rename(before, { label: 'x'.repeat(257) }); await expect(captured(before)).rejects.toThrow('group parameters');
  } finally { duringDigest = undefined; before.plugin.dispose(); after.plugin.dispose(); }
});
