import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { PluginContext } from 'molstar/lib/mol-plugin/context.js';
import { PluginStateSnapshotManager } from 'molstar/lib/mol-plugin-state/manager/snapshots.js';
import { StructureElement } from 'molstar/lib/mol-model/structure.js';
import { setCanvasModule } from 'molstar/lib/mol-geo/geometry/text/font-atlas.js';
import { BuretteGeometryMeasurement } from '../scripts/molstar-geometry-measurement.js';

setCanvasModule({ createCanvas: () => ({ getContext: () => ({
  measureText: () => ({ width: 12 }), clearRect() {}, fillText() {},
  getImageData: (_x, _y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
}) }) });
const dom = new Window(), previousDocument = globalThis.document;
globalThis.document = dom.document;
const plugin = new PluginContext({ actions: [], behaviors: [] });
const opened = new PluginContext({ actions: [], behaviors: [] });
try {
  await plugin.init();
  const data = await plugin.builders.data.rawData({ data: '4\npreview\nO 0 0 0\nH 1 0 0\nH 0 1 0\nH 0 1 1\n' });
  const trajectory = await plugin.builders.structure.parseTrajectory(data, 'xyz');
  const model = await plugin.builders.structure.createModel(trajectory);
  const structure = (await plugin.builders.structure.createStructure(model)).data;
  const point = i => StructureElement.Loci(structure, [{ unit: structure.units[0], indices: Int32Array.of(i) }]);
  const permanent = await plugin.managers.structure.measurement.addDistance(point(0), point(1));
  plugin.managers.structure.selection.fromLoci('set', point(3), false);
  const selection = plugin.managers.structure.selection.getSnapshot();
  const cells = [...plugin.state.data.cells.keys()];
  const visible = new Set(), owned = new Set();
  const factory = { create: async (...args) => { const repr = await BuretteGeometryMeasurement.create(...args); owned.add(repr); return repr; } };
  plugin.canvas3d = { add: repr => { if (owned.has(repr)) visible.add(repr); }, remove: repr => visible.delete(repr), dispose: () => visible.clear() };
  const window = { molstar: { lib: { structure: { StructureElement } }, BuretteGeometryMeasurement: factory } };
  vm.runInNewContext(readFileSync(new URL('../PreviewExtension/Web/geometry-preview.js', import.meta.url), 'utf8'), { window, Int32Array });
  const apply = action => window.BuretteGeometryPreview.apply({ plugin }, action);
  const params = { camera: false, image: false, canvas3d: false, structureSelection: true };
  const capture = key => plugin.managers.snapshot.add(PluginStateSnapshotManager.Entry(plugin.state.getSnapshot(params), { key }));
  capture('before');
  for (const [kind, atoms] of [['bond', [2, 0]], ['angle', [2, 0, 1]], ['dihedral', [3, 2, 0, 1]]]) {
    await apply({ kind, atoms });
    assert.equal(visible.size, 1);
    assert.deepEqual([...plugin.state.data.cells.keys()], cells, 'preview never enters the data state');
    assert.deepEqual(plugin.managers.structure.selection.getSnapshot(), selection);
    await plugin.state.data.build().to(permanent.representation).update({ customText: 'Saved distance' }).commit();
    assert.equal(visible.size, 1, 'unrelated measurement changes preserve the visible preview');
    capture(kind);
  }
  // Keep a raw canvas representation alive during serialization. Historical
  // entries captured during earlier previews must also remain free of previews.
  const archive = await plugin.managers.snapshot.serialize({ type: 'molx', params });
  assert.equal(visible.size, 1);
  await apply({ atoms: [] });
  assert.equal(visible.size, 0);
  await opened.init();
  await opened.managers.snapshot.open(new File([archive], 'preview-history.molx'));
  const entries = Array.from(opened.managers.snapshot.state.entries);
  assert.equal(entries.length, 4);
  for (const entry of entries) {
    await opened.state.setSnapshot(entry.snapshot);
    assert.equal(opened.managers.structure.measurement.state.distances.length, 1);
    assert.equal(opened.managers.structure.measurement.state.angles.length, 0);
    assert.equal(opened.managers.structure.measurement.state.dihedrals.length, 0);
    assert.ok(opened.state.data.cells.has(permanent.selection.ref));
    assert.ok(opened.state.data.cells.has(permanent.representation.ref));
    assert.deepEqual(opened.managers.structure.selection.getSnapshot(), selection);
  }
  console.log('Geometry snapshots: actual MOLX reopening of all 4 entries excludes live and historical previews; permanent refs and committed selection survive.');
} finally {
  plugin.dispose(); opened.dispose();
  globalThis.document = previousDocument;
  await dom.happyDOM.close();
}
