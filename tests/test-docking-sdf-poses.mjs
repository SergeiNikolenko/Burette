import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { PluginContext } from '@molstar/plugin';
import { DefaultPluginSpec } from '@molstar/plugin/default-spec';

const source = await readFile(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const extract = name => source.match(new RegExp(`\n  (?:async )?function ${name}\\([\\s\\S]*?\n  \\}`, 'u'))[0];
const split = new Function(`${extract('splitSdfRecords')}; return splitSdfRecords;`)();
const sdf = await readFile(new URL('../samples/mvs/lig1.sdf', import.meta.url), 'utf8');
const records = split(sdf);
assert.equal(records.length, 3);
const dom = new Window();
globalThis.document = dom.document;
const plugin = new PluginContext(DefaultPluginSpec());
try {
  await plugin.init();
  const viewer = { plugin };
  const receptor = await plugin.builders.data.rawData({ data: await readFile(new URL('../samples/mvs/Receptor_chain_A.pdb', import.meta.url), 'utf8') });
  const receptorTrajectory = await plugin.builders.structure.parseTrajectory(receptor, 'pdb');
  await plugin.builders.structure.hierarchy.applyPreset(receptorTrajectory, 'default', { representationPreset: 'empty' });
  const receptorRef = plugin.managers.structure.hierarchy.current.structures[0].cell.transform.ref;
  const functions = ['captureMolstarCameraSnapshot', 'molstarCurrentStructures', 'molstarStructureCellRefs', 'molstarStructureRefsOf', 'parseMolstarStructureTrajectories', 'switchCachedPoseLayer'].map(extract).join('\n');
  const switchPose = new Function('normalizeFormat', `${functions}; return switchCachedPoseLayer;`)(format => format);
  const state = { activeIndex: -1 };
  for (const index of [0, 1, 2, 0, 1]) {
    await switchPose(viewer, state, index, { data: `${records[index]}\n$$$$\n`, format: 'sdf', label: `Pose ${index + 1}` }, async structures => {
      assert.equal(structures.length, 1, 'each pose exposes one real Mol* structure');
      assert.equal(structures[0].cell.obj.data.elementCount, 39);
      const component = await plugin.builders.structure.tryCreateComponentStatic(structures[0].cell, 'all');
      await plugin.builders.structure.representation.addRepresentation(component, { type: 'ball-and-stick', color: 'element-symbol' });
    });
    assert.equal(state.activeIndex, index);
    const structures = plugin.managers.structure.hierarchy.current.structures;
    assert.equal(structures.length, 2, 'only receptor and the active pose remain in the live hierarchy');
    assert.ok(structures.some(structure => structure.cell.transform.ref === receptorRef));
    const ligand = structures.find(structure => structure.cell.transform.ref === state.activeRefs[0]);
    assert.equal(ligand.cell.obj.data.elementCount, 39);
    assert.equal(ligand.components[0].representations.length, 1, 'active pose retains actual representation');
  }
  const previousRefs = [...state.activeRefs];
  const previousIndex = state.activeIndex;
  const parseErrors = [];
  const reportError = console.error;
  try {
    console.error = (...args) => parseErrors.push(args);
    await assert.rejects(switchPose(viewer, state, 3, { data: 'invalid', format: 'sdf', label: 'Invalid pose' }, async () => {
      throw Error('Invalid pose must never reach representation');
    }));
  } finally {
    console.error = reportError;
  }
  assert.ok(parseErrors.length, 'invalid input exercises the real Mol* parse failure');
  assert.deepEqual(state.activeRefs, previousRefs);
  assert.equal(state.activeIndex, previousIndex);
  assert.equal(plugin.managers.structure.hierarchy.current.structures.length, 2, 'failed parsing preserves the visible pose');
  assert.equal(state.poseCache.has(3), false, 'failed parsing never poisons the pose cache');
  console.log('Real Mol* docking SDF poses parse, render, switch and recover from invalid input');
} finally {
  plugin.dispose();
  await dom.happyDOM.close();
}
