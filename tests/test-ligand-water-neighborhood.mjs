import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { parsePDB } = require('molstar/lib/commonjs/mol-io/reader/pdb/parser.js');
const { trajectoryFromPDB } = require('molstar/lib/commonjs/mol-model-formats/structure/pdb.js');
const { Structure, StructureSelection } = require('molstar/lib/commonjs/mol-model/structure.js');
const { Script } = require('molstar/lib/commonjs/mol-script/script.js');
const { StructureSelectionQueries } = require('molstar/lib/commonjs/mol-plugin-state/helpers/structure-selection-query.js');
const source = await readFile(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const context = vm.createContext({ activeConfig: { waterRepresentation: 'ligand-neighborhood' }, normalizeFormat: (value) => value });
vm.runInContext(source.slice(source.indexOf('  function isMolstarWaterComponent('),
  source.indexOf('  function countGroWaterAtoms(')), context);

// Two ligands, water exactly at the cutoff, one just beyond it, and a water
// whose oxygen is near but hydrogen extends outside the five-angstrom sphere.
const rows = [
  ['LIG', 1, 'C', 0, 0], ['LIG', 1, 'N', -1, 0], ['LIG', 1, 'O', -2, 0],
  ['LIG', 2, 'C', 20, 0], ['LIG', 2, 'N', 21, 0], ['LIG', 2, 'O', 22, 0],
  ['HOH', 3, 'O', 5, 0], ['HOH', 3, 'H', 5.8, 0],
  ['HOH', 4, 'O', 5.01, 0], ['HOH', 5, 'O', 24, 0],
  ['HOH', 6, 'O', 40, 0],
];
async function structureFor(atoms) {
  const pdb = atoms.map(([residue, seq, element, x, y], index) => {
    const coord = (value) => value.toFixed(3).padStart(8);
    return `HETATM${String(index + 1).padStart(5)} ${element.padStart(2).padEnd(4)} ${residue} A${String(seq).padStart(4)}    ${coord(x)}${coord(y)}${coord(0)}  1.00  0.00          ${element.padStart(2)}`;
  }).concat('END').join('\n');
  const parsed = await parsePDB(pdb).run();
  assert.equal(parsed.isError, false);
  const trajectory = await trajectoryFromPDB(parsed.result).run();
  return Structure.ofModel(trajectory.representative);
}
async function selectWater(structure) {
  let selected;
  const allWater = { cell: { obj: { label: 'Water' } }, representations: ['unfiltered-water'] };
  const rendered = [];
  const structureRef = { cell: {}, components: [allWater] };
  const plugin = {
    query: { structure: { registry: { list: Object.values(StructureSelectionQueries) } } },
    managers: { structure: {
      hierarchy: { current: { structures: [structureRef] } },
      component: { removeRepresentations: async (components) => {
        for (const component of components) component.representations = [];
      } },
    } },
    builders: { structure: { tryCreateComponentFromExpression: async (_, expression) => {
      selected = StructureSelection.unionStructure(Script.getStructureSelection(expression, structure));
      return selected.elementCount ? { obj: { data: selected } } : null;
    }, representation: { addRepresentation: async (component) => rendered.push(component.obj.data) } } },
  };
  await context.applyMolstarWaterLineRepresentation({ plugin });
  assert.deepEqual(allWater.representations, [], 'the unfiltered water layer must be removed');
  assert.deepEqual(rendered, selected.elementCount ? [selected] : [], 'only the selected waters may be rendered');
  const residues = [];
  for (const unit of selected.units) {
    const hierarchy = unit.model.atomicHierarchy;
    for (const element of unit.elements) {
      residues.push(hierarchy.residues.auth_seq_id.value(hierarchy.residueAtomSegments.index[element]));
    }
  }
  return residues.sort((a, b) => a - b);
}

assert.deepEqual(await selectWater(await structureFor(rows)), [3, 3, 5]);
assert.deepEqual(await selectWater(await structureFor(rows.filter(([name]) => name === 'HOH'))), []);
console.log('Ligand-water selection passed: 5 Å boundary, whole waters, multiple ligands, no ligand.');
