import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { PluginContext } from '@molstar/plugin';
import { DefaultPluginSpec } from '@molstar/plugin/default-spec';
import { StateTransforms } from '@molstar/viewer/state-transforms';
import { parseSdf } from '@molstar/io/reader/sdf/parser';

const source = readFileSync('PreviewExtension/Web/viewer.js', 'utf8');
const extract = name => source.match(new RegExp(`\n  (?:async )?function ${name}\\([\\s\\S]*?\n  \\}`, 'u'))[0];
const sceneWindow = { molstar: { lib: { plugin: { StateTransforms } } } };
vm.runInNewContext(readFileSync('PreviewExtension/Web/scene-file-actions.js', 'utf8'), { window: sceneWindow, TextEncoder });
const functions = ['normalizeFormat', 'parseMolstarStructureTrajectories', 'loadMolstarEntry'].map(extract).join('\n');
const load = new Function('window', `${functions}; return loadMolstarEntry;`)(sceneWindow);
const scene = sceneWindow.BuretteSceneFiles;
const dom = new Window();
const previousDocument = globalThis.document;
globalThis.document = dom.document;
const plugin = new PluginContext(DefaultPluginSpec());
const viewer = { plugin };
const split = new Function(`${extract('splitSdfRecords')}; return splitSdfRecords;`)();
// Use the existing producer's header normalization for this pose fixture.
const records = split(readFileSync('samples/mvs/lig1.sdf', 'utf8'));
const sdf = records.map(record => record + '\n\n$$$$\n').join('');
const record = records[0] + '\n\n';
const tiny = 'Ligand\nBurette\n\n  1  0  0  0  0  0            999 V2000\n    1.0000    2.0000    3.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\nM  END\n';
const v3000 = 'Ligand\nBurette\n\n  0  0  0     0  0            999 V3000\nM  V30 BEGIN CTAB\nM  V30 COUNTS 1 0 0 0 0\nM  V30 BEGIN ATOM\nM  V30 1 C 1 2 3 0\nM  V30 END ATOM\nM  V30 END CTAB\nM  END\n';
try {
  await plugin.init();
  await load(viewer, { format: 'pdb', data: readFileSync('samples/mvs/Receptor_chain_A.pdb', 'utf8'), label: 'receptor' }, { representationPreset: 'empty' });
  const receptor = plugin.managers.structure.hierarchy.current.models[0].cell.transform.ref;
  let restored = 0;
  const context = { capture: () => ({ camera: 'unchanged' }), restore: () => restored++, load };
  await scene.append(viewer, { sources: [{ path: '/ligands.sdf', format: 'sdf', data: sdf }] }, context);
  const models = plugin.managers.structure.hierarchy.current.models;
  assert.equal(models.length, 4, 'one receptor and all three real SDF models survive');
  assert.equal(models[0].cell.transform.ref, receptor);
  const parsed = await parseSdf(sdf).run();
  for (let i = 0; i < 3; i++) {
    const model = models[i + 1].cell.obj.data;
    assert.equal(model.atomicHierarchy.atoms._rowCount, 39);
    assert.equal(model.atomicConformation.x[0], Math.fround(parsed.result.compounds[i].molFile.atoms.x.value(0)));
    assert.equal(model.atomicConformation.y[0], Math.fround(parsed.result.compounds[i].molFile.atoms.y.value(0)));
    assert.equal(model.atomicConformation.z[0], Math.fround(parsed.result.compounds[i].molFile.atoms.z.value(0)));
  }
  assert.ok(plugin.managers.structure.hierarchy.current.structures.slice(1).every(s => s.components.some(c => c.representations.length)));
  const before = [...plugin.state.data.cells.keys()];
  for (const delimiter of ['$$$$\n', '$$$$ suffix\r\n', '$$$$\r']) {
    const text = Array.from({ length: 197 }, () => tiny.replaceAll('\n', delimiter.endsWith('\r') ? '\r' : '\n') + delimiter).join('');
    await assert.rejects(scene.append(viewer, { sources: [{ path: '/too-many.sdf', format: 'sdf', data: text }] }, context), /200 loaded models/);
    assert.deepEqual([...plugin.state.data.cells.keys()], before, 'preflight must not allocate raw data or parse state');
  }
  await assert.rejects(load(viewer, { format: 'sd', data: (record + '$$$$\n').repeat(196) + record,
    loadPreset: 'preset-trajectory-all-models' }), /200 loaded models/, 'unterminated final record and preset aliases count');
  assert.deepEqual([...plugin.state.data.cells.keys()], before);
  // Repeated appends consume the same live model budget, including hidden models.
  await load(viewer, { format: 'sdf', data: (tiny + '$$$$\n').repeat(100), label: 'hundred', loadPreset: 'all-models' }, { representationPreset: 'empty' });
  await load(viewer, { format: 'sdf', data: (v3000 + '$$$$\r\n').repeat(96), label: 'v3000', loadPreset: 'all-models' }, { representationPreset: 'empty' });
  assert.equal(plugin.managers.structure.hierarchy.current.models.length, 200);
  const atLimit = [...plugin.state.data.cells.keys()];
  await assert.rejects(load(viewer, { format: 'sdf', data: tiny, loadPreset: 'all-models' }), /200 loaded models/);
  assert.deepEqual([...plugin.state.data.cells.keys()], atLimit);
  await plugin.state.data.build().delete(plugin.managers.structure.hierarchy.current.models.at(-1).cell.transform.ref).commit();
  await load(viewer, { format: 'sdf', data: tiny, loadPreset: 'all-models' }, { representationPreset: 'empty' });
  assert.equal(plugin.managers.structure.hierarchy.current.models.length, 200, 'deleting a model releases actual capacity');
  assert.equal(restored, 1, 'preflight refusal leaves the camera untouched');
  const remove = plugin.state.data.build();
  for (const model of plugin.managers.structure.hierarchy.current.models.slice(-3)) remove.delete(model.cell.transform.ref);
  await remove.commit();
  const fields = ['group_PDB', 'id', 'type_symbol', 'label_atom_id', 'label_alt_id', 'label_comp_id', 'label_asym_id',
    'label_entity_id', 'label_seq_id', 'pdbx_PDB_ins_code', 'Cartn_x', 'Cartn_y', 'Cartn_z', 'occupancy', 'B_iso_or_equiv',
    'pdbx_formal_charge', 'auth_asym_id', 'pdbx_PDB_model_num'];
  const cif = [1, 2, 3].map(i => `data_ligand${i}\nloop_\n${fields.map(f => `_atom_site.${f}`).join('\n')}\nHETATM 1 C C1 . UNK . . 0 ? 4 5 6 1 0 0 . 1\n#\n`).join('');
  const beforeBatch = [...plugin.state.data.cells.keys()];
  await assert.rejects(scene.append(viewer, { sources: [
    { path: '/first.mol', format: 'mol', data: tiny }, { path: '/multi.cif', format: 'cif', data: cif },
  ] }, context), /200 loaded models/);
  assert.deepEqual([...plugin.state.data.cells.keys()], beforeBatch, 'later multi-block overflow rolls back the entire append');
  assert.equal(plugin.managers.structure.hierarchy.current.models.length, 197);
  assert.equal(restored, 2);
  await scene.append(viewer, { sources: [{ path: '/first.mol', format: 'mol', data: tiny }] }, context);
  assert.equal(plugin.managers.structure.hierarchy.current.models.length, 198, 'failed batch does not retain source paths or reservations');
  const concurrent = await Promise.allSettled([
    load(viewer, { format: 'sdf', data: tiny, loadPreset: 'all-models' }, { representationPreset: 'empty' }),
    scene.append(viewer, { sources: [{ path: '/racing.sdf', format: 'sdf', data: tiny }] }, context),
  ]);
  assert.equal(concurrent[0].status, 'fulfilled', 'a rejected append must not delete an independent active load');
  assert.equal(concurrent[1].status, 'rejected');
  assert.match(concurrent[1].reason.message, /Wait for/);
  assert.equal(plugin.managers.structure.hierarchy.current.models.length, 199);
} finally {
  plugin.dispose();
  globalThis.document = previousDocument;
  await dom.happyDOM.close();
}

// Exercise parser authority, rollback and concurrency without manufacturing
// hundreds of GPU representations. Real parsing/rendering is exercised above.
function fakeViewer(existing = 0) {
  const models = Array.from({ length: existing }, () => ({}));
  const cells = new Map([['root', { transform: { parent: 'root' } }]]);
  const applied = [];
  let rawId = 0;
  const viewer = { plugin: {
    managers: { structure: { hierarchy: { current: { models } } } },
    state: { data: { cells, build: () => { const deleted = []; return {
      delete(ref) { deleted.push(ref); return this; },
      async commit() { for (const ref of deleted) cells.delete(ref); },
    }; } } },
    builders: { data: { rawData: async () => { const ref = `raw${++rawId}`; cells.set(ref, { transform: { parent: 'root' } }); return { ref }; } },
      structure: { hierarchy: { applyPreset: async (...args) => applied.push(args) } } },
  } };
  return { viewer, models, cells, applied };
}
const trajectory = count => ({ obj: { data: { frameCount: count } } });
for (const data of [
  (tiny.replace('Ligand\nBurette\n\n', '$$$$ title\n$$$$ program\n$$$$ comment\n') + '$$$$\n').repeat(101),
  (tiny + '> <property>\n$$$$ first property value\n\n$$$$\n').repeat(101),
]) {
  const parsed = await parseSdf(data).run();
  assert.equal(parsed.result.compounds.length, 101);
  const f = fakeViewer();
  await scene.loadModels(f.viewer, { format: 'sdf', data, loadPreset: 'all-models' }, async () => [trajectory(101)]);
  assert.equal(f.applied.length, 1, 'delimiter-looking scientific values remain ordinary data');
}
{
  // Consecutive property headers are consumed differently from first values.
  // A skipped header must not hide every following record separator.
  const data = (tiny + '> <first>\nvalue\n> <second>\n$$$$\n').repeat(201);
  assert.equal((await parseSdf(data).run()).result.compounds.length, 201);
  const f = fakeViewer();
  await assert.rejects(scene.loadModels(f.viewer, { format: 'sdf', data, loadPreset: 'all-models' },
    async () => { throw new Error('must refuse before parsing'); }), /200 loaded models/);
  assert.deepEqual([...f.cells.keys()], ['root']);
}
for (const count of [201, NaN, Infinity, 1.5, -1, 0]) {
  const f = fakeViewer();
  await assert.rejects(scene.loadModels(f.viewer, { format: 'sdf', data: tiny, loadPreset: 'all-models' }, async () => [trajectory(count)]), /model/);
  assert.equal(f.applied.length, 0, 'parser-derived count must be admitted before any preset');
  assert.deepEqual([...f.cells.keys()], ['root']);
}
{
  const f = fakeViewer(199);
  await assert.rejects(scene.loadModels(f.viewer, { format: 'mmcif', data: 'coordinate blocks' }, async () => [trajectory(1), trajectory(1)]), /200 loaded models/);
  assert.equal(f.applied.length, 0, 'all CIF blocks are counted before the first representation');
  assert.deepEqual([...f.cells.keys()], ['root']);
  await scene.loadModels(f.viewer, { format: 'sdf', data: tiny }, async () => [trajectory(10_000)]);
  assert.equal(f.applied.length, 1, 'default animation materializes one model, not every frame');
}
{
  const f = fakeViewer();
  let release;
  const entered = new Promise(resolve => { release = resolve; });
  f.viewer.plugin.builders.structure.hierarchy.applyPreset = () => entered;
  const first = scene.loadModels(f.viewer, { format: 'sdf', data: tiny }, async () => [trajectory(1)]);
  await assert.rejects(scene.loadModels(f.viewer, { format: 'sdf', data: tiny }, async () => [trajectory(1)]), /Wait for/);
  release();
  await first;
  await scene.loadModels(f.viewer, { format: 'sdf', data: tiny }, async () => [trajectory(1)]);
}
// The multi-block parser refuses before creating any per-block trajectory.
{
  let transforms = 0;
  const blocks = Array.from({ length: 201 }, () => ({ categories: { atom_site: { rowCount: 1 } } }));
  const parse = new Function('window', `${extract('parseMolstarStructureTrajectories')}; return parseMolstarStructureTrajectories;`)(sceneWindow);
  const builder = { to() { return this; }, apply(transform) { if (transform === StateTransforms.Model.TrajectoryFromMmCif) transforms++; return this; },
    commit: async () => ({ obj: { data: { blocks } } }) };
  await assert.rejects(parse({ state: { data: { build: () => builder } } }, {}, 'mmcif'), /200 loaded models/);
  assert.equal(transforms, 0);
}
console.log('Scene model limits preserve real ligand coordinates, reject expansion, and release capacity after deletion or failure');
