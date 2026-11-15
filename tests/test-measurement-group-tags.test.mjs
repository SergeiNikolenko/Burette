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
const transfer = value => ({ version: 1, sourceFormat: value.sourceFormat, targetSourceSha256: value.sourceSha256, atomCount: value.atomCount, items: value.items, group: value.group, ...(value.groupParams ? { groupParams: value.groupParams } : {}), ...(value.groupTags ? { groupTags: value.groupTags } : {}) });
const measurements = value => [...value.plugin.state.data.cells.values()].filter(cell =>
  String(cell.transform.transformer?.id).includes('structure-selections-') && ['Distance', 'Angle', 'Dihedral', 'Label', 'Orientation', 'Plane'].includes(cell.obj?.label));

const nativeFlags = { isHidden: true, isCollapsed: true, isLocked: true, isGhost: true };
const groups = v => [...v.plugin.state.data.cells.values()].filter(cell => cell.transform.tags?.includes('measurement-group'));
const metadata = { label: 'Authored group 漢字', description: 'Exact group description\r\nwith UTF-8 β' };
const rename = async (v, params) => v.plugin.state.data.build().to(v.plugin.managers.structure.measurement.getGroup().ref).update(params).commit();

const sourceTags = ['measurement-group', 'group-provenance:session-v2', 'review:β'];
async function setGroup(v, params, tags) {
  const group = v.plugin.managers.structure.measurement.getGroup();
  group.update(params); group.updateTagged(params, tags); await group.commit();
  return group.ref;
}

test('group tags replace stale native tags exactly beside params and four flags before baseline ACK', async () => {
  const before = await viewer(), after = await viewer();
  try {
    const distance = await before.plugin.managers.structure.measurement.addDistance(before.loci([0]), before.loci([2]));
    const sourceRef = await setGroup(before, metadata, sourceTags);
    for (const ref of [distance.selection.ref, distance.representation.ref, sourceRef]) before.plugin.state.data.updateCellState(ref, nativeFlags);
    await setGroup(after, { label: 'Stale label', description: 'Stale description' }, ['measurement-group', 'stale-only']);
    const snapshot = before.plugin.state.data.getSnapshot(), value = transfer(await captured(before));
    expect(before.plugin.state.data.getSnapshot()).toEqual(snapshot); expect(value.groupTags).toEqual(sourceTags);
    await runtime.restore(after, value, science);
    const restored = groups(after)[0]; expect(restored.transform.tags).toEqual(sourceTags);
    expect(restored.params.values).toEqual(metadata); expect(restored.state).toEqual(nativeFlags);
    expect(after.plugin.state.data.tree.transforms.get(restored.transform.ref).state).toEqual(nativeFlags);
    const baseline = BuretteGeometry.binding(after.plugin);
    await BuretteGeometry.update(after.plugin, baseline.text, BuretteGeometry.capture(after.plugin, () => true, baseline.lease));
    expect(transfer(await captured(after))).toEqual(value);
  } finally { before.plugin.dispose(); after.plugin.dispose(); }
});

test('empty group keeps sixteen exact tags; tags-only and absent-tag payloads use explicit native defaults', async () => {
  const before = await viewer(), after = await viewer(), onlyTags = await viewer(), legacy = await viewer();
  try {
    const tags = ['measurement-group', ...Array.from({ length: 15 }, (_, i) => `group-${i}-`.padEnd(100, 'x'))];
    const ref = await setGroup(before, metadata, tags); before.plugin.state.data.updateCellState(ref, nativeFlags);
    const value = transfer(await captured(before)); await runtime.restore(after, value, science);
    expect(groups(after)).toHaveLength(1); expect(groups(after)[0].transform.tags).toEqual(tags);
    expect(transfer(await captured(after))).toEqual(value); expect(measurements(after)).toHaveLength(0);
    const { groupParams: _params, ...tagsOnly } = value; await runtime.restore(onlyTags, tagsOnly, science);
    expect(groups(onlyTags)[0].transform.tags).toEqual(tags); expect(groups(onlyTags)[0].params.values).toEqual({ label: 'Measurements', description: '' });
    const { groupTags: _tags, ...withoutTags } = value; await runtime.restore(legacy, withoutTags, science);
    expect(groups(legacy)[0].transform.tags).toEqual(['measurement-group']); expect((await captured(legacy)).groupParams).toEqual(metadata);
  } finally { before.plugin.dispose(); after.plugin.dispose(); onlyTags.plugin.dispose(); legacy.plugin.dispose(); }
});

test('invalid, missing-owner or wrong-role tags refuse before hash/mutation and native malformed tags cannot capture', async () => {
  const before = await viewer(), after = await viewer();
  try {
    await before.plugin.managers.structure.measurement.addDistance(before.loci([0]), before.loci([1]));
    const value = transfer(await captured(before)), snapshot = after.plugin.state.data.getSnapshot();
    const invalid = [undefined, null, false, {}, 'tag', [], ['custom-only'], ['measurement-group', 'measurement-group'],
      ['measurement-group', ''], ['measurement-group', 1], ['measurement-group', 'x'.repeat(101)],
      ['measurement-group', ...Array.from({ length: 16 }, (_, i) => `tag-${i}`)],
      ...['measurement-order-label', 'burette-scene-layer-v1:foreign', 'structure-component-static-all', 'structure-focus-derived'].map(tag => ['measurement-group', tag])];
    let hashes = 0;
    for (const groupTags of invalid) {
      duringDigest = () => { hashes++; };
      await expect(runtime.restore(after, { ...value, groupTags }, science)).rejects.toThrow('group tags');
      expect(after.plugin.state.data.getSnapshot()).toEqual(snapshot);
    }
    duringDigest = undefined; expect(hashes).toBe(0);
    await before.plugin.managers.structure.measurement.getGroup().tag('structure-focus-derived').commit();
    await expect(captured(before)).rejects.toThrow('group tags');
    const params = { label: 'L'.repeat(256), description: 'D'.repeat(1024) };
    const tooLarge = ['measurement-group', ...Array.from({ length: 15 }, (_, i) => `${i}`.padEnd(100, '漢'))];
    await setGroup(before, params, tooLarge);
    await expect(captured(before)).rejects.toThrow('cannot be retained within this preview');
  } finally { duringDigest = undefined; before.plugin.dispose(); after.plugin.dispose(); }
});
