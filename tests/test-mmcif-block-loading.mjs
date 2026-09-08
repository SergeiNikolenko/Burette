import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { PluginContext } from 'molstar/lib/mol-plugin/context.js';
import { StateTransforms } from 'molstar/lib/mol-plugin-state/transforms.js';
import { applyStructureInteractivity } from 'molstar/lib/extensions/plugin/interactivity.js';
import { StructureElement } from 'molstar/lib/mol-model/structure.js';

const window = new Window();
const previous = { window: globalThis.window, document: globalThis.document };
Object.assign(globalThis, { window, document: window.document });
const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const helper = source.match(/\n  async function parseMolstarStructureTrajectories\([\s\S]*?\n  \}/u)?.[0];
assert.ok(helper);
const parse = new Function('window', `${helper}; return parseMolstarStructureTrajectories;`)({ molstar: { lib: { plugin: { StateTransforms } } } });
const fields = ['group_PDB', 'id', 'type_symbol', 'label_atom_id', 'label_alt_id', 'label_comp_id', 'label_asym_id', 'label_entity_id', 'label_seq_id', 'pdbx_PDB_ins_code', 'Cartn_x', 'Cartn_y', 'Cartn_z', 'occupancy', 'B_iso_or_equiv', 'pdbx_formal_charge', 'auth_asym_id', 'pdbx_PDB_model_num'];
const block = (name, rows) => `data_${name}\nloop_\n${fields.map(name => `_atom_site.${name}`).join('\n')}\n${rows}\n#\n`;
const protein = block('protein', [1, 2].flatMap(model => [
  `ATOM 1 N N . GLY A 1 1 ? 0 0 ${model} 1 0 0 A ${model}`,
  `ATOM 2 C CA . GLY A 1 1 ? 1 0 ${model} 1 0 0 A ${model}`,
]).join('\n'));
const ligand = block('ligand', 'HETATM 1 C C1 . UNK . . 0 ? 4 5 6 1 0 0 . 1\nHETATM 2 N N1 . UNK . . 0 ? 5 5 6 1 0 0 . 1');
const otherLigand = block('other_ligand', 'HETATM 1 C C1 . UNK . . 0 ? 40 5 6 1 0 0 . 1\nHETATM 2 N N1 . UNK . . 0 ? 41 5 6 1 0 0 . 1');
const plugin = new PluginContext({ actions: [], behaviors: [] });
try {
  await plugin.init();
  const raw = await plugin.builders.data.rawData({ data: `data_metadata\n_entry.id metadata\n${protein}${ligand}${otherLigand}`, label: 'multi-block.cif' });
  const trajectories = await parse(plugin, raw, 'mmcif');
  assert.deepEqual(trajectories.map(t => t.obj.data.frameCount), [2, 1, 1], 'coordinate blocks load independently; metadata is skipped and model counts are preserved');
  const structures = [];
  for (const trajectory of trajectories) {
    const model = await plugin.builders.structure.createModel(trajectory);
    const structure = await plugin.builders.structure.createStructure(model);
    structures.push(structure);
  }
  assert.deepEqual(structures.map(s => s.obj.data.elementCount), [2, 2, 2]);
  const ligandModel = structures[1].obj.data.models[0];
  assert.deepEqual([ligandModel.atomicConformation.x[0], ligandModel.atomicConformation.y[0], ligandModel.atomicConformation.z[0]], [4, 5, 6], 'the ligand retains its source coordinate frame');

  const context = vm.createContext({ window: {}, console, setTimeout, clearTimeout, performance });
  vm.runInContext(readFileSync(new URL('../PreviewExtension/Web/burette-agent.js', import.meta.url), 'utf8'), context);
  const interactions = [];
  const cameraTargets = [];
  plugin.managers.camera.focusLoci = loci => cameraTargets.push(loci);
  const viewer = { plugin, structureInteractivity: action => {
    interactions.push(action);
    applyStructureInteractivity(plugin, action);
  } };
  const agent = context.window.BuretteAgent;
  agent.attach({ viewer, plugin, config: { label: 'multi-block.cif', format: 'mmcif' } });
  agent.notifyStructureLoaded();
  const summary = await agent.run({ command: 'summary', args: { includeLigands: true } });
  assert.equal(summary.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(summary.result.counts)), { structures: 3, models: 3, atoms: 6, residues: 3, chains: 3, ligands: 2 });
  const focused = await agent.run({ command: 'focusLigand', args: { index: 1 } });
  assert.equal(focused.ok, true);
  assert.equal(focused.result.ligand.label_comp_id, 'UNK');
  assert.equal(focused.result.ligand.atomCount, 2);
  assert.equal(focused.result.ligand.structureId, structures[2].ref);
  assert.deepEqual(JSON.parse(JSON.stringify(focused.result.counts)), { atoms: 2, residues: 1, chains: 1 });
  assert.ok(interactions.some(action => action.action === 'focus' && action.elements.label_comp_id === 'UNK'));
  assert.deepEqual(structures.map(s => StructureElement.Loci.size(plugin.managers.structure.selection.getLoci(s.obj.data))), [0, 0, 2], 'actual Mol* selection stays in the chosen CIF block');
  assert.equal(cameraTargets.at(-1).structure, structures[2].obj.data, 'the camera targets the second ligand, not the first matching residue address');
  assert.equal((await agent.run({ command: 'focusSelection', args: { selection: focused.result.selectionId } })).ok, true);
  assert.equal(cameraTargets.at(-1).structure, structures[2].obj.data, 'saved selections retain block identity');
  const firstLigand = await agent.run({ command: 'focusLigand', args: { selector: { structure: summary.result.structures[1].ligands[0].structureId } } });
  assert.equal(firstLigand.ok, true, 'the reported structure identity also disambiguates a selector without an index');
  assert.deepEqual(structures.map(s => StructureElement.Loci.size(plugin.managers.structure.selection.getLoci(s.obj.data))), [0, 2, 0]);
  assert.equal(cameraTargets.at(-1).structure, structures[1].obj.data);

  const singleRaw = await plugin.builders.data.rawData({ data: protein, label: 'single-block.cif' });
  assert.deepEqual((await parse(plugin, singleRaw, 'mmcif')).map(t => t.obj.data.frameCount), [2], 'single-block model handling is unchanged');
  const unknownAminoAcid = block('unknown-amino-acid', 'ATOM 1 C CA . UNK A 1 1 ? 1 2 3 1 0 0 A 1');
  const unknownRaw = await plugin.builders.data.rawData({ data: unknownAminoAcid, label: 'unknown.cif' });
  const [unknownTrajectory] = await parse(plugin, unknownRaw, 'mmcif');
  await plugin.builders.structure.createStructure(await plugin.builders.structure.createModel(unknownTrajectory));
  assert.equal((await agent.run({ command: 'summary', args: { includeLigands: true } })).result.counts.ligands, 2, 'ATOM UNK is still a protein residue');
  console.log('mmCIF block loading and ligand actions passed');
} finally {
  plugin.dispose();
  Object.assign(globalThis, previous);
  await window.happyDOM.close();
}
