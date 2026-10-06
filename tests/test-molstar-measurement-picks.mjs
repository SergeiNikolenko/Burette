import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { PluginContext } from 'molstar/lib/mol-plugin/context.js';
import { StructureElement, Bond } from 'molstar/lib/mol-model/structure.js';
import { Loci } from 'molstar/lib/mol-model/loci.js';
import { OrderedSet } from 'molstar/lib/mol-data/int.js';
import { setCanvasModule } from 'molstar/lib/mol-geo/geometry/text/font-atlas.js';

setCanvasModule({ createCanvas: () => ({ getContext: () => ({
  measureText: () => ({ width: 12 }), clearRect() {}, fillText() {},
  getImageData: (_x, _y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
}) }) });
const dom = new Window();
const previousDocument = globalThis.document;
globalThis.document = dom.document;
const plugin = new PluginContext({ actions: [], behaviors: [] });
const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const functionSource = name => source.match(new RegExp(`\n  function ${name}\\([\\s\\S]*?\n  \\}`, 'u'))[0];
try {
  await plugin.init();
  const data = await plugin.builders.data.rawData({ data: readFileSync(new URL('../samples/structures/proteins/1htb.pdb', import.meta.url), 'utf8') });
  const trajectory = await plugin.builders.structure.parseTrajectory(data, 'pdb');
  const model = await plugin.builders.structure.createModel(trajectory);
  const structure = await plugin.builders.structure.createStructure(model);
  const ligand = await plugin.builders.structure.tryCreateComponentStatic(structure, 'ligand');
  assert.ok(ligand?.data);
  const ligandUnit = ligand.data.units.find(unit => unit.elements.length >= 8);
  const subset = StructureElement.Loci(ligand.data, [{ unit: ligandUnit, indices: Int32Array.of(1, 3, 5, 7) }]);
  const component = await plugin.builders.structure.tryCreateComponent(ligand, {
    type: { name: 'bundle', params: StructureElement.Bundle.fromLoci(subset) },
    nullIfEmpty: true, label: 'Ligand subset',
  }, 'measurement-subset');
  const unit = component.data.units[0];
  const picks = [0, 1, 2, 3].map(index => StructureElement.Loci(component.data, [{ unit, indices: OrderedSet.ofSingleton(index) }]));
  const expected = picks.map(pick => StructureElement.Loci.remap(pick, structure.data));
  assert.notEqual(OrderedSet.getAt(expected[0].elements[0].indices, 0), 0, 'fixture must expose component-local index mismatch');

  let now = 0;
  let pending;
  const manager = plugin.managers.structure.measurement;
  for (const method of ['addDistance', 'addAngle', 'addDihedral']) {
    const original = manager[method].bind(manager);
    manager[method] = (...args) => (pending = original(...args));
  }
  const bindings = {
    activeMolstarViewer: () => ({ plugin }),
    window: { molstar: { lib: { loci: { Loci }, structure: { StructureElement, Bond } } } },
    document: dom.document, performance: { now: () => now },
    molstarLociIsEmpty: StructureElement.Loci.isEmpty,
    showMolstarMeasurePrompt() {}, captureMolstarSceneUndoSnapshot: () => ({}),
    pushMolstarEditUndoSnapshot() {}, setStatus: message => { throw new Error(message); },
  };
  const begin = new Function(...Object.keys(bindings), `
    ${source.match(/  const MOLSTAR_MEASURE_KINDS = \{[\s\S]*?\n  \};/u)[0]}
    let molstarMeasureSession = null;
    ${['molstarContextElementLoci', 'cancelMolstarMeasurement', 'molstarMeasurePrompt', 'beginMolstarMeasurement'].map(functionSource).join('\n')}
    return beginMolstarMeasurement;
  `)(...Object.values(bindings));

  for (const [kind, count] of [['distance', 2], ['angle', 3], ['dihedral', 4]]) {
    assert.equal(begin(kind), true);
    for (const pick of picks.slice(0, count)) {
      now += 200;
      plugin.behaviors.interaction.click.next({ current: { loci: pick } });
    }
    const measured = await pending;
    const actual = measured.selection.obj.data.map(entry => entry.loci);
    assert.deepEqual(actual.map(loci => {
      const location = StructureElement.Loci.getFirstLocation(loci);
      return { unit: location.unit.id, element: location.element, center: Loci.getBoundingSphere(loci).center };
    }), expected.slice(0, count).map(loci => {
      const location = StructureElement.Loci.getFirstLocation(loci);
      return { unit: location.unit.id, element: location.element, center: Loci.getBoundingSphere(loci).center };
    }), `${kind} must retain the picked ligand atoms through measurement bundle serialization`);
    if (kind === 'distance') {
      const centers = picks.slice(0, 2).map(loci => Loci.getBoundingSphere(loci).center);
      const midpoint = centers[0].map((value, axis) => (value + centers[1][axis]) / 2);
      const text = measured.representation.obj.data.repr.renderObjects.find(object => object.type === 'text');
      assert.ok(text, 'distance must render a text label');
      assert.deepEqual(Array.from(text.values.aPosition.ref.value.slice(0, 3)), Array.from(new Float32Array(midpoint)), 'label anchor must be halfway between the picked atoms');
    }
  }
  console.log('Mol* measurement picks: ligand distance label, angle and dihedral preserve atom coordinates');
} finally {
  plugin.dispose();
  globalThis.document = previousDocument;
  await dom.happyDOM.close();
}
