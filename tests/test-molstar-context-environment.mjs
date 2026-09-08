import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parsePDB } = require('molstar/lib/commonjs/mol-io/reader/pdb/parser.js');
const { trajectoryFromPDB } = require('molstar/lib/commonjs/mol-model-formats/structure/pdb.js');
const { Structure, StructureElement } = require('molstar/lib/commonjs/mol-model/structure.js');
const viewer = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const functionSource = name => {
  const match = viewer.match(new RegExp(`\n  (?:async )?function ${name}\\([\\s\\S]*?\n  \\}`, 'u'));
  assert.ok(match, `missing ${name}`);
  return match[0];
};

// Real Mol* geometry: two separate models parsed from the existing crystal
// fixture, retaining coordinates. A lookup limited to the ligand model cannot
// return any of these protein residues.
const lines = readFileSync(new URL('../samples/structures/proteins/1htb.pdb', import.meta.url), 'utf8').split('\n');
async function parseStructure(records, id) {
  const parsed = await parsePDB(`${records.join('\n')}\nEND\n`, id).run();
  assert.equal(parsed.isError, false);
  const trajectory = await trajectoryFromPDB(parsed.result).run();
  return Structure.ofModel(trajectory.representative);
}
const receptor = await parseStructure(lines.filter(line => line.startsWith('ATOM  ')), 'receptor');
const ligand = await parseStructure(lines.filter(line => line.startsWith('HETATM') && line.slice(17, 20) === 'NAD' && line[21] === 'A'), 'ligand');
const pick = Structure.toStructureElementLoci(ligand);
const { StateTransforms } = require('molstar/lib/commonjs/mol-plugin-state/transforms.js');
const queryLoci = new Function('window', 'molstarStructureRuntime', 'compositionQueryCache', `${functionSource('compositionQueryLoci')}; return compositionQueryLoci;`)(
  { molstar: { lib: { plugin: { StateTransforms } } } }, () => ({ Structure }), new WeakMap(),
);
const ligandRef = { cell: { obj: { data: ligand } } };
assert.equal(StructureElement.Loci.size(queryLoci(ligandRef, 'organic and resn NAD and chain A and resi 377')), 44);
assert.equal(queryLoci(ligandRef, 'polymer and chain B'), null);

const surroundings = new Function('window', 'molstarContextElementLoci', `${functionSource('molstarSurroundingsLoci')}; return molstarSurroundingsLoci;`)(
  { molstar: { lib: { structure: { StructureElement } } } }, loci => loci,
);
const neighbors = surroundings({ loci: pick }, 5, receptor);
assert.ok(neighbors && StructureElement.Loci.size(neighbors) > 0, 'separate receptor must contribute neighbors');
assert.equal(neighbors.structure, receptor);
assert.equal(StructureElement.Loci.size(surroundings({ loci: pick }, 5, ligand)), 44);

// Pinning must use the live native focus behavior and copy its transforms.
// In particular, no second ball-and-stick preset may drift from Mol* settings.
const pinSource = functionSource('pinMolstarEnvironment');
assert.match(pinSource, /await behavior.focus\(loci\)/);
assert.match(pinSource, /behavior.ensureShape\(structure.cell\)/);
assert.match(pinSource, /child.transform.transformer, child.params.values/);
assert.doesNotMatch(pinSource, /addRepresentation|sizeFactor|color:/);

// Empty order-label cleanup must never call Mol*'s group-creating method.
// Hundreds of panel close events cannot produce hundreds of Measurements rows.
const measurementCells = new Map();
const addCell = (ref, parent, tags) => measurementCells.set(ref, { transform: { ref, parent, tags } });
addCell('empty-a', 'root', ['measurement-group']);
addCell('empty-b', 'root', ['measurement-group']);
addCell('real', 'root', ['measurement-group']);
addCell('distance', 'real', []);
addCell('temporary', 'root', ['measurement-group']);
addCell('order', 'temporary', ['measurement-order-label']);
let originalCalls = 0;
let commits = 0;
const manager = { async addOrderLabels() { originalCalls++; } };
const measurementPlugin = { managers: { structure: { measurement: manager } }, state: { data: {
  cells: measurementCells,
  build() {
    const deletes = [];
    return { delete(ref) { deletes.push(ref); }, async commit() { commits++; deletes.forEach(ref => measurementCells.delete(ref)); } };
  },
} } };
const guard = new Function('guardedMeasurementManagers', 'debug', `${functionSource('guardMolstarMeasurementOrderLabels')}; return guardMolstarMeasurementOrderLabels;`)(new WeakSet(), () => {});
guard({ plugin: measurementPlugin });
await Promise.all(Array.from({ length: 200 }, () => manager.addOrderLabels([])));
assert.equal(originalCalls, 0);
assert.equal(commits, 1);
assert.deepEqual([...measurementCells.keys()], ['real', 'distance']);
await manager.addOrderLabels([pick]);
assert.equal(originalCalls, 1, 'real measurement picks must still reach Mol*');
console.log(`Pinned environment verified: ${StructureElement.Loci.size(neighbors)} receptor atoms; measurement cleanup survives 200 calls.`);

// Atom picking must override a molecule-level preference only for the session,
// display exactly the accepted points, and restore state on finish or Escape.
let click;
let keydown;
let now = 0;
let picked = [];
const priorSelection = ['prior'];
const measured = [];
const pickPlugin = {
  selectionMode: false,
  behaviors: { interaction: { click: { subscribe(fn) { click = fn; return { unsubscribe() {} }; } } } },
  managers: {
    interactivity: { props: { granularity: 'structure' }, setProps(value) { Object.assign(this.props, value); } },
    structure: {
      selection: { getSnapshot: () => priorSelection, setSnapshot(value) { picked = value; }, clear() { picked = []; }, fromLoci(_op, value) { picked.push(value); } },
      measurement: { addAngle(...points) { measured.push(points); return Promise.resolve(); } },
    },
  },
};
const measurementFns = new Function('activeMolstarViewer', 'window', 'document', 'performance', 'molstarContextElementLoci', 'molstarLociIsEmpty', 'captureMolstarSceneUndoSnapshot', 'pushMolstarEditUndoSnapshot', 'setStatus', `
  const MOLSTAR_MEASURE_KINDS = { angle: { points: 3, method: 'addAngle', noun: 'angle' } };
  let molstarMeasureSession = null;
  ${['showMolstarMeasureToast', 'cancelMolstarMeasurement', 'molstarMeasurePrompt', 'beginMolstarMeasurement'].map(functionSource).join('\n')}
  return { beginMolstarMeasurement };
`)(() => ({ plugin: pickPlugin }), { molstar: { lib: { loci: { Loci: { areEqual: (a, b) => a === b } } } } },
  { addEventListener(_name, fn) { keydown = fn; }, removeEventListener() {} }, { now: () => now }, x => x, x => !x,
  () => ({}), () => {}, () => {});
measurementFns.beginMolstarMeasurement('angle');
assert.equal(pickPlugin.managers.interactivity.props.granularity, 'element');
for (let i = 1; i <= 3; i++) {
  now += 200;
  click({ current: { loci: i } });
  if (i < 3) assert.deepEqual(picked, Array.from({ length: i }, (_, index) => index + 1));
}
assert.deepEqual(measured, [[1, 2, 3]]);
assert.equal(pickPlugin.managers.interactivity.props.granularity, 'structure');
assert.equal(picked, priorSelection);
measurementFns.beginMolstarMeasurement('angle');
keydown({ key: 'Escape' });
assert.equal(pickPlugin.managers.interactivity.props.granularity, 'structure');
assert.equal(pickPlugin.selectionMode, false);
assert.equal(picked, priorSelection);

// RDKit's retained source coordinates must select the matching Mol* atoms,
// without expanding to their entire ligand or using transformed scene positions.
let selectedPreviewLoci = null;
const selectPreviewAtoms = new Function('molstarStructureFromRef', 'activeMolstarViewer', 'molstarContextElementLoci', 'scheduleSceneTreeRender',
  `${functionSource('selectMolstarMoleculePreviewAtoms')}; return selectMolstarMoleculePreviewAtoms;`)(
  value => value, () => ({ plugin: { managers: { structure: { selection: {
    clear() { selectedPreviewLoci = null; },
    fromLoci(_modifier, loci, applyGranularity) { assert.equal(applyGranularity, false); selectedPreviewLoci = loci; },
  } } } } }), value => value, () => {},
);
const previewUnit = ligand.units[0];
const previewIndices = [0, previewUnit.elements.length - 1];
const previewPositions = previewIndices.map(index => {
  const atom = previewUnit.elements[index];
  const c = previewUnit.model.atomicConformation;
  return [c.x[atom], c.y[atom], c.z[atom]];
});
selectPreviewAtoms({ structure: ligand, atomLoci: { elements: [{ unit: previewUnit }] } }, previewPositions);
assert.equal(StructureElement.Loci.size(selectedPreviewLoci), 2);
assert.deepEqual(selectedPreviewLoci.elements[0].indices, previewIndices);
selectPreviewAtoms({ structure: ligand }, []);
assert.equal(selectedPreviewLoci, null);
