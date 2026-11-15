import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { Window } from 'happy-dom';
import { PluginContext } from '@molstar/plugin';
import { DefaultPluginSpec } from '@molstar/plugin/default-spec';
import { StateTransforms } from '@molstar/viewer/state-transforms';
import { to_mmCIF } from '@molstar/model/model/structure/export/mmcif';
import { CIF } from '@molstar/io/reader/cif';

const dom = new Window();
globalThis.document = dom.document;
const plugin = new PluginContext(DefaultPluginSpec());
const window = { molstar: { lib: { plugin: { StateTransforms } } } };
runInNewContext(await readFile(new URL('../PreviewExtension/Web/sdf-collection-scene.js', import.meta.url), 'utf8'), { window, setTimeout });
const show = options => window.BuretteSdfCollection.show(plugin, { ...base, ...options });
// Different molecules deliberately overlap. The double bond and hydrogen must
// survive the ensemble conversion; there must be no inter-molecular bonds.
const molecules = [
  { atoms: [{ element: 'C', x: 0, y: 0, z: 0 }, { element: 'O', x: 1.2, y: 0, z: 0 }], bonds: [{ a: 1, b: 2, order: 2 }] },
  { atoms: [{ element: 'N', x: 0, y: 0, z: 0 }, { element: 'H', x: 1, y: 0, z: 0 }], bonds: [{ a: 1, b: 2, order: 1 }] },
  { atoms: [{ element: 'Cl', x: 0, y: 0, z: 0 }], bonds: [] }
];
const base = {
  molecules, labels: ['', 'ammonia', ''], all: false, index: 0, spread: false,
  spreadMolecules: items => items.map((m, i) => ({ ...m, atoms: m.atoms.map(a => ({ ...a, x: a.x + i * 10 })) })),
  foreground: { type: 'ball-and-stick', color: 'element-symbol' },
  background: { type: 'ball-and-stick', color: 'uniform', colorParams: { value: 0x888888 }, typeParams: { alpha: .3 } }
};
const structure = () => {
  const roots = plugin.managers.structure.hierarchy.current.structures;
  assert.equal(roots.length, 1, 'no inactive or duplicate structures in exports');
  return roots[0];
};
const atoms = () => structure().cell.obj.data.elementCount;
const componentAtoms = () => structure().components.map(c => c.cell.obj.data.elementCount);
const componentColors = () => structure().components.map(c => c.representations[0].cell.transform.params.colorTheme.name);
const hiddenComponents = () => structure().components.map(c => [c, ...c.representations].every(ref => ref.cell.state.isHidden));
const viewerSource = await readFile(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const exportHelpers = ['molstarStructureFromRef', 'molstarComponentStructuresForExport', 'molstarUnionComponentStructures', 'molstarCurrentStructuresForExport'].map(name => {
  const start = viewerSource.indexOf(`  function ${name}(`);
  return viewerSource.slice(start, viewerSource.indexOf('\n  function ', start + 1));
}).join('\n');
const exportStructures = runInNewContext(`${exportHelpers}\nmolstarCurrentStructuresForExport`, {
  activeViewer: { plugin }, molstarExportLib: () => ({}), molstarExportStructureName: () => 'molecule'
});
let parses = 0;
try {
  await plugin.init();
  const parse = plugin.builders.structure.parseTrajectory.bind(plugin.builders.structure);
  plugin.builders.structure.parseTrajectory = (...args) => { parses++; return parse(...args); };
  await show({});
  assert.equal(atoms(), 2);
  let hostRan = false;
  setTimeout(() => { hostRan = true; }, 0);
  await show({ all: true });
  assert.equal(hostRan, true, 'host work runs during scene construction');
  assert.equal(atoms(), 5);
  const ensemble = structure().cell.obj.data;
  assert.equal(ensemble.models.length, 3);
  assert.equal(ensemble.interUnitBonds.edgeCount, 0);
  assert.deepEqual(ensemble.units.map(u => Array.from(u.bonds.edgeProps.order)), [[2, 2], [1, 1], []]);
  assert.deepEqual(componentAtoms(), [2, 2, 1], 'every molecule is its own component');
  assert.deepEqual(structure().components.map(c => c.cell.obj.label), ['Molecule 1', 'ammonia', 'Molecule 3']);
  assert.deepEqual(componentColors(), ['element-symbol', 'uniform', 'uniform']);
  const exported = exportStructures();
  const cif = await CIF.parseText(to_mmCIF('ensemble', exported.map(e => e.structure), false, { copyAllCategories: true })).run();
  assert.equal(cif.isError, false);
  assert.equal(exported.length, 3);
  assert.equal(cif.result.blocks[0].categories.atom_site.rowCount, 5, 'the existing mmCIF writer receives every selected atom');
  const trajectory = structure().cell.transform.parent;
  await show({ all: true, index: 2 });
  assert.deepEqual(componentAtoms(), [2, 2, 1]);
  assert.deepEqual(componentColors(), ['uniform', 'uniform', 'element-symbol'], 'selection restyles molecules in place');
  const root = structure().cell.transform.ref;
  await show({ all: true, index: 2, background: { type: 'line', color: 'element-symbol', typeParams: { alpha: .6 } } });
  assert.equal(structure().cell.transform.ref, root, 'style does not reload molecules');
  assert.equal(structure().components[1].representations.length, 1);
  assert.equal(structure().components[1].representations[0].cell.transform.params.type.name, 'line');
  for (const all of [false, true, false, true]) {
    await show({ all, index: 1 });
    assert.equal(atoms(), all ? 5 : 2);
  }
  assert.equal(parses, 1, 'Single/All and selection reuse parsed trajectory');
  assert.equal(structure().cell.transform.parent, trajectory);
  // What the scene tree does when the user hides one molecule.
  const hide = structure().components[1];
  for (const ref of [hide, ...hide.representations]) plugin.state.data.updateCellState(ref.cell.transform.ref, { isHidden: true });
  await show({ all: true, index: 0 });
  assert.deepEqual(hiddenComponents(), [false, true, false], 'selection keeps a hidden molecule hidden');
  await show({ all: false, index: 0 });
  await show({ all: true, index: 0 });
  assert.deepEqual(hiddenComponents(), [false, true, false], 'Single/All keeps a hidden molecule hidden');
  await show({ all: true, index: 0, spread: true });
  assert.deepEqual(hiddenComponents(), [false, true, false], 'layout keeps a hidden molecule hidden');
  for (const ref of [structure().components[1], ...structure().components[1].representations]) plugin.state.data.updateCellState(ref.cell.transform.ref, { isHidden: false });
  await show({ all: true, index: 0 });
  await show({ all: true, spread: true });
  assert.equal(atoms(), 5);
  assert.equal(structure().cell.obj.data.models[2].atomicConformation.x[0], 20);
  assert.equal(molecules[2].atoms[0].x, 0, 'spread never changes source coordinates');
  await show({ all: true });
  assert.equal(structure().cell.obj.data.models[2].atomicConformation.x[0], 0);
  await plugin.clear();
  await show({ all: true });
  assert.equal(atoms(), 5, 'external clear invalidates cached selectors');
  const many = Array.from({ length: 65 }, (_, i) => ({ atoms: [{ element: 'C', x: i, y: 0, z: 0 }], bonds: [] }));
  await show({ molecules: many, all: true, index: 3 });
  assert.deepEqual(componentAtoms(), [1, 64], 'large ensembles share one background component');
  await show({ all: true });
  const previous = structure().cell.transform.ref;
  const add = plugin.builders.structure.representation.addRepresentation;
  plugin.builders.structure.representation.addRepresentation = async () => { throw Error('representation failure'); };
  await assert.rejects(show({ all: false }), /representation failure/);
  assert.equal(structure().cell.transform.ref, previous, 'failed transaction preserves last scene');
  plugin.builders.structure.representation.addRepresentation = add;
  await show({ all: false, index: 2 });
  assert.equal(atoms(), 1, 'retry succeeds after rolled-back state');
  console.log('SDF scene: real Mol* topology, selection, per-molecule visibility, styles, caching, spread, failure/retry and yielding passed');
} finally {
  plugin.dispose();
  await dom.happyDOM.close();
}
