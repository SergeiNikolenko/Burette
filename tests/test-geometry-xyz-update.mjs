// Live XYZ owner: actual guarded coordinate runtime and compiled-model source facade.
// Transient hover is covered by test-geometry-preview-transient/snapshots.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { PluginContext } from 'molstar/lib/mol-plugin/context.js';
import { StructureElement } from 'molstar/lib/mol-model/structure.js';
import { Loci } from 'molstar/lib/mol-model/loci.js';
import { Vec3 } from 'molstar/lib/mol-math/linear-algebra.js';
import { setCanvasModule } from 'molstar/lib/mol-geo/geometry/text/font-atlas.js';
import { BuretteGeometry } from '../scripts/molstar-geometry.js';

setCanvasModule({ createCanvas: () => ({ getContext: () => ({
  measureText: () => ({ width: 12 }), clearRect() {}, fillText() {},
  getImageData: (_x, _y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
}) }) });
const dom = new Window();
const previousDocument = globalThis.document;
globalThis.document = dom.document;
const plugin = new PluginContext({ actions: [], behaviors: [] });
try {
  await plugin.init();
  const data = await plugin.builders.data.rawData({ data: '4\nfixture\nO 0 0 0\nH 1 0 0\nH 0 1 0\nH 0 1 1\n' });
  const trajectory = await plugin.builders.structure.parseTrajectory(data, 'xyz');
  const model = await plugin.builders.structure.createModel(trajectory);
  const structure = await plugin.builders.structure.createStructure(model);
  const unit = structure.data.units[0];
  const points = [0, 1, 2, 3].map(i => StructureElement.Loci(structure.data, [{ unit, indices: Int32Array.of(i) }]));
  const manager = plugin.managers.structure.measurement;
  const permanent = await manager.addDistance(points[0], points[1]);
  plugin.managers.structure.selection.fromLoci('set', points[1], false);
  const selection = plugin.managers.structure.selection.getSnapshot();
  const window = { molstar: { lib: { structure: { StructureElement } }, BuretteGeometry } };
  vm.runInNewContext(readFileSync(new URL('../PreviewExtension/Web/geometry-preview.js', import.meta.url), 'utf8'), { window, Int32Array });
  const originalText = data.cell.obj.data;
  const sourceRef = data.ref;
  const structureRef = structure.ref;
  // XYZ updates follow a genuine saved measurement, not a transient hover.
  const previewRef = permanent.representation.ref;
  const update = text => window.BuretteGeometryPreview.update({ plugin }, { text });
  const measurementDistance = () => {
    const pair = plugin.state.data.cells.get(previewRef).obj.data.sourceData.pairs[0].loci;
    return Vec3.distance(...pair.map(loci => Loci.getBoundingSphere(loci).center));
  };
  const startedAt = performance.now();
  const topology = () => {
    const bonds = plugin.managers.structure.hierarchy.current.structures[0].cell.obj.data.units[0].bonds;
    return [Array.from(bonds.a), Array.from(bonds.b), Array.from(bonds.edgeProps.order), Array.from(bonds.edgeProps.flags)];
  };
  const originalTopology = topology();
  await update(originalText.replace('H 1 0 0', 'H 1.5 0 0'));
  assert.ok(Math.abs(measurementDistance() - 1.5) < 1e-5, 'measurement follows the changed coordinates');
  assert.equal(plugin.managers.structure.hierarchy.current.structures[0].cell.transform.ref, structureRef, 'existing scene branch is retained');
  await Promise.all([update(originalText.replace('H 1 0 0', 'H 1.6 0 0')), update(originalText.replace('H 1 0 0', 'H 1.7 0 0'))]);
  assert.ok(Math.abs(measurementDistance() - 1.7) < 1e-5, 'latest coordinates win concurrent updates');
  assert.notDeepEqual(topology(), originalTopology, 'stretching a bond beyond the distance cutoff removes it');
  await update(originalText.replace('H 1 0 0', 'H 2.0379 0 0').replace('H 0 1 0', 'H 0 2 0'));
  const stretchedBonds = plugin.managers.structure.hierarchy.current.structures[0].cell.obj.data.units[0].bonds;
  assert.equal(stretchedBonds.getEdgeIndex(0, 1), -1, 'O–H at 2.0379 angstrom is not bonded');
  assert.equal(stretchedBonds.getEdgeIndex(0, 2), -1, 'O–H at 2 angstrom is not bonded');
  await update(originalText.replace('H 1 0 0', 'H 0.1 0.1 0'));
  assert.deepEqual(topology(), originalTopology, 'compressing an angle must not infer new H–H bonds');
  await update(originalText);
  assert.deepEqual(topology(), originalTopology, 'returning to the original distances restores the bonds');
  assert.equal(plugin.state.data.cells.get(sourceRef).obj.data, originalText, 'cancel restores original geometry');
  assert.ok(Math.abs(measurementDistance() - 1) < 1e-5);
  await assert.rejects(update(originalText.replace('H 1 0 0', 'C 1 0 0')), /atom identities/);
  assert.equal(plugin.state.data.cells.get(sourceRef).obj.data, originalText, 'invalid updates cannot mutate the source');
  assert.ok(plugin.state.data.cells.has(permanent.selection.ref), 'live editing preserves user measurements');
  assert.deepEqual(plugin.managers.structure.selection.getSnapshot(), selection, 'live editing preserves committed atom selection');
  console.log(`Live Geometry: scene identity, measurement updates, latest-value coalescing and rollback passed (${Math.round(performance.now() - startedAt)} ms for fixture updates)`);
} finally {
  plugin.dispose();
  globalThis.document = previousDocument;
  await dom.happyDOM.close();
}
