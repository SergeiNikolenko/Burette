import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { PluginContext } from 'molstar/lib/mol-plugin/context.js';
import { Structure, StructureElement } from 'molstar/lib/mol-model/structure.js';
import { BuretteGeometryMeasurement } from '../scripts/molstar-geometry-measurement.js';
import { setCanvasModule } from 'molstar/lib/mol-geo/geometry/text/font-atlas.js';

setCanvasModule({ createCanvas: () => ({ getContext: () => ({
  measureText: () => ({ width: 12 }), clearRect() {}, fillText() {},
  getImageData: (_x, _y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
}) }) });
const dom = new Window();
const previousDocument = globalThis.document;
globalThis.document = dom.document;
const plugin = new PluginContext({ actions: [], behaviors: [] });
const xyz = '4\npreview\nO 0 0 0\nH 1 0 0\nH 0 1 0\nH 0 1 1\n';
const gate = () => {
  let release, started;
  return { waiting: new Promise(resolve => { release = resolve; }), entered: new Promise(resolve => { started = resolve; }),
    release: () => release(), start: () => started() };
};
try {
  await plugin.init();
  const data = await plugin.builders.data.rawData({ data: xyz });
  const trajectory = await plugin.builders.structure.parseTrajectory(data, 'xyz');
  const model = await plugin.builders.structure.createModel(trajectory);
  await plugin.builders.structure.createStructure(model);
  const root = () => plugin.managers.structure.hierarchy.current.structures[0].cell;
  const original = root().obj.data;
  const unit = original.units[0];
  const points = [0, 1, 2, 3].map(i => StructureElement.Loci(original, [{ unit, indices: Int32Array.of(i) }]));
  const manager = plugin.managers.structure.measurement;
  const permanent = await manager.addDistance(points[0], points[1]);
  plugin.managers.structure.selection.fromLoci('set', points[1], false);
  const selection = plugin.managers.structure.selection.getSnapshot();
  const visible = new Set(), created = [];
  const create = async (...args) => {
    const repr = await BuretteGeometryMeasurement.create(...args);
    const destroy = repr.destroy.bind(repr);
    repr.destroyCount = 0;
    repr.destroy = () => { repr.destroyCount++; destroy(); };
    created.push(repr);
    return repr;
  };
  plugin.canvas3d = { add: repr => { if (created.includes(repr)) visible.add(repr); }, remove: repr => visible.delete(repr), dispose: () => visible.clear() };
  const window = { molstar: { lib: { structure: { StructureElement } }, BuretteGeometryMeasurement: { create } } };
  vm.runInNewContext(readFileSync(new URL('../PreviewExtension/Web/geometry-preview.js', import.meta.url), 'utf8'), { window, Int32Array });
  const runtime = window.BuretteGeometryPreview;
  const viewer = { plugin };
  const apply = action => runtime.apply(viewer, action);
  const highlighted = () => plugin.managers.interactivity.lociHighlights.prev.flatMap(({ loci }) =>
    loci.elements.flatMap(({ unit, indices }) => Array.from(indices, index => unit.elements[index])));
  await apply({ atoms: [3, 1] });
  assert.deepEqual(highlighted(), [3, 1], 'multiple atoms use actual Mol* highlight semantics');
  for (const [kind, atoms, key] of [['bond', [2, 0], 'distances'], ['angle', [2, 0, 1], 'angles'], ['dihedral', [3, 2, 0, 1], 'dihedrals']]) {
    await apply({ kind, atoms });
    const repr = [...visible][0];
    assert.ok(repr.renderObjects.length > 0);
    const source = repr.getAllLoci()[0].shape.sourceData;
    const groups = kind === 'bond' ? source.pairs[0].loci : kind === 'angle' ? source.triples[0].loci : source.quads[0].loci;
    assert.deepEqual(groups.map(loci => loci.elements[0].unit.elements[loci.elements[0].indices[0]]), atoms);
    await apply({ atoms: [] });
    assert.equal(visible.size, 0);
    assert.equal(repr.destroyCount, 1);
  }
  for (const action of [{ atoms: [1, 1] }, { atoms: [-1] }, { atoms: [0.5] }, { atoms: [999] }, { kind: 'bond', atoms: [1] }, { kind: 'unknown', atoms: [0] }]) {
    await apply(action);
    assert.deepEqual(highlighted(), []);
    assert.equal(manager.state.distances.length, 1);
  }
  // Real Mol* units can contain non-contiguous model indices. Assembly copies
  // repeat those indices; multi-model structures have separate index namespaces.
  const cell = root();
  cell.obj.data = Structure.create([unit.getChild(Int32Array.of(1, 3))]);
  await apply({ atoms: [3, 1] });
  assert.deepEqual(highlighted(), [3, 1]);
  cell.obj.data = Structure.create([unit, unit.getCopy(unit.id + 1, unit.invariantId, unit.chainGroupId)]);
  await apply({ atoms: [0, 1] });
  assert.deepEqual(highlighted(), [], 'assembly ambiguity is refused');
  cell.obj.data = original;
  const otherData = await plugin.builders.data.rawData({ data: xyz.replace(/^4/u, "5") + "C 2 2 2\n" });
  const otherTrajectory = await plugin.builders.structure.parseTrajectory(otherData, "xyz");
  const secondModel = await plugin.builders.structure.createModel(otherTrajectory);
  const other = Structure.ofModel(secondModel.data);
  cell.obj.data = Structure.create([unit, ...other.units.map((u, i) => u.getCopy(unit.id + i + 1, u.invariantId, u.chainGroupId))]);
  assert.equal(cell.obj.data.models.length, 2);
  await apply({ atoms: [4] });
  assert.deepEqual(highlighted(), [], 'even an index unique to one model cannot select across model namespaces');
  cell.obj.data = original;
  const factory = window.molstar.BuretteGeometryMeasurement;
  let held = gate();
  factory.create = async (...args) => { const repr = await create(...args); held.start(); await held.waiting; return repr; };
  const pending = apply({ kind: 'angle', atoms: [2, 0, 1] });
  await held.entered;
  const cleared = apply({ atoms: [] });
  held.release();
  await Promise.all([pending, cleared]);
  assert.equal(visible.size, 0, 'late hover cannot reappear after clear');
  assert.equal(created.at(-1).destroyCount, 1);
  held = gate();
  const stale = apply({ kind: 'angle', atoms: [2, 0, 1] });
  await held.entered;
  await plugin.state.data.build().to(data).update({ data: xyz.replace('H 1 0 0', 'H 1.2 0 0') }).commit();
  assert.notEqual(root().obj.data, original, 'actual source update replaces the structure generation');
  const fresh = root().obj.data;
  plugin.managers.interactivity.lociHighlights.highlightOnly({ loci: StructureElement.Loci(fresh, [{ unit: fresh.units[0], indices: Int32Array.of(3) }]) }, false);
  held.release();
  await stale;
  assert.equal(visible.size, 0, 'measurement created for a replaced source is destroyed');
  assert.equal(created.at(-1).destroyCount, 1);
  assert.deepEqual(highlighted(), [3], 'late factory completion preserves a fresh native hover');
  factory.create = create;
  await Promise.all([apply({ kind: 'angle', atoms: [2, 0, 1] }), apply({ kind: 'bond', atoms: [1, 0] })]);
  assert.equal(visible.size, 1);
  assert.equal(manager.state.distances.length, 1, 'hover never creates a state measurement');
  await apply({ atoms: [] });
  assert.ok(plugin.state.data.cells.has(permanent.selection.ref), 'saved measurement survives preview cleanup');
  // Restoring the source also exercises the queue against a real state update.
  await plugin.state.data.build().to(data).update({ data: xyz }).commit();
  assert.deepEqual(plugin.managers.structure.selection.getSnapshot(), selection, 'preview preserves committed selection');

  window.BuretteAgent = { run: () => { throw new Error('Preview must not change agent selection'); } };
  // Execute the real receiver body, with only its asynchronous script transport held.
  const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
  const declaration = source.match(/\n  async function executeBuretteAgentAction\(action\) \{[\s\S]*?\n  \}/u)[0];
  const globals = source.slice(source.indexOf('  let geometryPreviewRequest ='), source.indexOf(declaration));
  let active = viewer, loads = 0, loading = gate();
  let load = async () => { loads++; loading.start(); await loading.waiting; window.BuretteGeometryPreview = runtime; };
  const receive = new Function('window', 'activeMolstarViewer', 'loadScript', 'runtimeURL', `${globals}\n${declaration}\nreturn executeBuretteAgentAction;`)(window, () => active, (...args) => load(...args), (_key, fallback) => fallback);
  window.BuretteGeometryPreview = undefined;
  const first = receive({ type: 'preview_geometry', atoms: [0] });
  await loading.entered;
  const latest = receive({ type: 'preview_geometry', atoms: [1, 3] });
  assert.equal(loads, 1, 'overlapping hovers share one module load');
  loading.release();
  await Promise.all([first, latest]);
  assert.deepEqual(highlighted(), [1, 3]);
  await apply({ atoms: [] });
  window.BuretteGeometryPreview = undefined;
  loading = gate();
  const changedViewer = receive({ type: 'preview_geometry', atoms: [1] });
  await loading.entered;
  active = { plugin };
  loading.release();
  await changedViewer;
  assert.deepEqual(highlighted(), [], 'late load cannot target a different viewer');
  active = viewer;
  window.BuretteGeometryPreview = undefined;
  loading = gate();
  const changedSource = receive({ type: 'preview_geometry', atoms: [1] });
  await loading.entered;
  await plugin.state.data.build().to(data).update({ data: xyz.replace('H 1 0 0', 'H 1.1 0 0') }).commit();
  loading.release();
  await changedSource;
  assert.deepEqual(highlighted(), [], 'late load cannot target a new structure generation');
  window.BuretteGeometryPreview = undefined;
  load = async () => { throw new Error('load failed'); };
  await assert.rejects(receive({ type: 'preview_geometry', atoms: [1] }), /load failed/);
  load = async () => { window.BuretteGeometryPreview = runtime; };
  await receive({ type: 'preview_geometry', atoms: [1, 2] });
  assert.deepEqual(highlighted(), [1, 2], 'module load failure remains retryable');
  await apply({ atoms: [] });
  assert.ok(plugin.state.data.cells.has(permanent.selection.ref));
  await plugin.state.data.build().to(data).update({ data: xyz + xyz.replace('H 1 0 0', 'H 1.3 0 0') }).commit();
  await apply({ kind: 'angle', atoms: [2, 0, 1] });
  const framePreview = created.at(-1);
  await plugin.state.data.build().to(model).update({ modelIndex: 1 }).commit();
  assert.equal(visible.size, 0, 'frame changes dispose an already visible preview without another apply');
  assert.equal(framePreview.destroyCount, 1);
  held = gate();
  factory.create = async (...args) => { const repr = await create(...args); held.start(); await held.waiting; return repr; };
  const disposed = apply({ kind: 'bond', atoms: [0, 1] });
  await held.entered;
  plugin.dispose();
  held.release();
  await disposed;
  assert.equal(created.at(-1).destroyCount, 1, 'in-flight representation is destroyed after plugin disposal');
  assert.equal(visible.size, 0);
  console.log('Transient geometry: actual Mol* multi-atom highlight, exact measurement endpoints, ambiguity guards, stale hover/source/load races and saved-state preservation passed.');
} finally {
  plugin.dispose();
  globalThis.document = previousDocument;
  await dom.happyDOM.close();
}
