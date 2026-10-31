import { afterAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { PluginContext } from 'molstar/lib/mol-plugin/context.js';
import { DefaultPluginSpec } from 'molstar/lib/mol-plugin/spec.js';
import { StructureElement } from 'molstar/lib/mol-model/structure.js';
import { StateTransforms } from 'molstar/lib/mol-plugin-state/transforms.js';
import { setCanvasModule } from 'molstar/lib/mol-geo/geometry/text/font-atlas.js';
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


const nativeFlags = { isHidden: true, isCollapsed: true, isLocked: true, isGhost: true };
const groupState = value => {
  const group = [...value.plugin.state.data.cells.values()].find(c => c.transform.tags?.includes('measurement-group'));
  return { state: { ...group.state }, transform: { ...group.transform.state }, tree: { ...value.plugin.state.data.tree.transforms.get(group.transform.ref).state } };
};
for (const restoreFirst of [false, true]) test(`baseline Geometry insertion retains actual group state (C2 restore ${restoreFirst})`, async () => {
  const source = await viewer(), candidate = await viewer();
  try {
    const result = await source.plugin.managers.structure.measurement.addDistance(source.loci([0]), source.loci([2]));
    for (const ref of [result.selection.ref,result.representation.ref,source.plugin.managers.structure.measurement.getGroup().ref]) source.plugin.state.data.updateCellState(ref,nativeFlags);
    const v = restoreFirst ? candidate : source;
    if (restoreFirst) await runtime.restore(v,transfer(await captured(source)),science);
    const before = groupState(v); console.log('GROUP BEFORE',restoreFirst,before);
    const baseline = BuretteGeometry.binding(v.plugin);
    await BuretteGeometry.update(v.plugin,baseline.text,BuretteGeometry.capture(v.plugin,()=>true,baseline.lease));
    const after = groupState(v); console.log('GROUP AFTER',restoreFirst,after);
    expect(after).toEqual(before);
    expect((await captured(v)).group).toEqual(nativeFlags);
  } finally { source.plugin.dispose();candidate.plugin.dispose(); }
});
