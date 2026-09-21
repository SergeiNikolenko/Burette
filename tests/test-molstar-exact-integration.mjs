import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { PluginContext } from 'molstar/lib/mol-plugin/context.js';
import { DefaultPluginSpec } from 'molstar/lib/mol-plugin/spec.js';
import { StateTransforms } from 'molstar/lib/mol-plugin-state/transforms.js';
import { Camera } from 'molstar/lib/mol-canvas3d/camera.js';
import { Mat4 } from 'molstar/lib/mol-math/linear-algebra.js';
import { BuretteSelection } from '../scripts/molstar-selection-facade.js';

test('parsed CIF, real Mol* selection manager, transformed scene and camera revisions', async () => {
  const dom = new Window();
  const previousDocument = globalThis.document;
  globalThis.document = dom.document;
  const plugin = new PluginContext(DefaultPluginSpec());
  let agent;
  try {
    await plugin.init();
    // Actual state, parser and selection managers; no WebGL rendering in this test.
    const cif = (await readFile(new URL('../samples/mini.cif', import.meta.url), 'utf8'))
      .replace('ATOM 1 N N .', 'ATOM 17 N N A').replace('0.000 0.000 0.000 1.00', '0.000 0.000 0.000 0.00')
      .replace('1.450 0.000 0.000 1.00', '1.450 0.000 0.000 .')
      .replace('2.000 1.400 0.000 1.00', '2.000 1.400 0.000 ?');
    const structures = [];
    for (let index = 0; index < 2; index++) {
      const data = await plugin.builders.data.rawData({ data: cif, label: `object-${index}` });
      const trajectory = await plugin.builders.structure.parseTrajectory(data, 'mmcif');
      const model = await plugin.builders.structure.createModel(trajectory);
      structures.push(await plugin.builders.structure.createStructure(model));
    }
    const camera = new Camera();
    const originalCanvas = plugin.canvas3d;
    plugin.canvas3d = { camera, mark() {} };
    const context = { console, setTimeout, clearTimeout, TextDecoder, TextEncoder,
      window: { molstar: { BuretteSelection } } };
    vm.createContext(context);
    vm.runInContext(await readFile(new URL('../PreviewExtension/Web/burette-agent.js', import.meta.url), 'utf8'), context);
    agent = context.window.BuretteAgent;
    agent.attach({ viewer: { plugin }, plugin, config: { documentId: 'fixture' } });
    agent.notifyStructureLoaded();
    async function run(command, args) {
      const reply = await agent.run({ command, args });
      assert.equal(reply.ok, true, JSON.stringify(reply.error));
      return reply.result;
    }
    const query = expression => run('queryAtoms', { selectionVersion: 1, expression });
    const initial = await query({ kind: 'all' });
    assert.equal(initial.total, 8);
    assert.equal((await query({ fields: { atom_id: 17 } })).total, 2);
    assert.equal((await query({ fields: { occupancy: 0 } })).total, 2);
    assert.equal((await query({ fields: { label_alt_id: 'A' } })).total, 2);
    assert.equal(initial.atoms.filter(atom => atom.occupancy === null).length, 4);
    const target = initial.atoms.find(atom => atom.structureId === structures[1].ref && atom.atom_id === 17);
    const groupArgs = { selectionVersion: 1, groupBy: 'residue', expression: { ids: [target.id] } };
    const groupPage = await run('queryGroups', groupArgs);
    assert.equal(groupPage.total, 1);
    const targetGroup = groupPage.groups[0];
    assert.equal(targetGroup.partial, true);
    assert.equal(targetGroup.wholeGroupAtoms, 4);
    assert.equal((await query(targetGroup.groupExpression)).total, 4);
    const selected = await run('selectAtoms', { selectionVersion: 1, expression: { ids: [target.id] }, mode: 'set',
      sceneId: initial.sceneId, expectedRevision: initial.revision });
    assert.equal(selected.selectedCount, 1);
    assert.equal(plugin.managers.structure.selection.stats.elementCount, 1);
    assert.equal(plugin.managers.structure.selection.getLoci(structures[0].data).elements.length, 0);
    assert.equal(plugin.managers.structure.selection.getLoci(structures[1].data).elements.length, 1);
    const actualCurrent = await query({ current: true });
    assert.equal(actualCurrent.total, 1);
    assert.equal(actualCurrent.atoms[0].id, target.id);
    await run('namedSelection', { selectionVersion: 1, operation: 'save', name: 'moving atom', expression: { current: true },
      sceneId: actualCurrent.sceneId, expectedRevision: actualCurrent.revision });
    const beforeCamera = agent.selectionState().revision;
    camera.position[0] += 1;
    camera.update();
    assert.ok(agent.selectionState().revision > beforeCamera);
    // Decorator leaves the immutable source at x=0, but scene query must use x=10.
    const matrix = Mat4.identity(); matrix[12] = 10;
    const transform = await plugin.state.data.build().to(structures[1]).apply(StateTransforms.Model.TransformStructureConformation,
      { transform: { name: 'matrix', params: { data: matrix, transpose: false } } }).commit();
    const moved = await query({ fields: { structureId: structures[1].ref, atom_id: 17 } });
    assert.equal(moved.atoms[0].position[0], 10);
    assert.equal(moved.atoms[0].id, target.id);
    assert.equal((await query({ named: 'moving atom' })).atoms[0].position[0], 10);
    assert.equal((await run('queryGroups', groupArgs)).groups[0].id, targetGroup.id);
    const spatial = await query({ within: { radiusAngstrom: 0.01, of: { ids: [target.id] } } });
    assert.deepEqual(Array.from(spatial.atoms, atom => atom.id), [target.id]);
    assert.equal((await query({ byResidue: { within: { radiusAngstrom: 0.01, of: { ids: [target.id] } } } })).total, 4);
    const stationary = initial.atoms.find(atom => atom.structureId === structures[0].ref && atom.atom_id === 17);
    const distance = await run('measureGeometry', { selectionVersion: 1, sceneId: moved.sceneId,
      expectedRevision: moved.revision, measurement: 'distance', atomIds: [stationary.id, target.id] });
    assert.equal(distance.value, 10);
    const movedSelection = await run('selectAtoms', { selectionVersion: 1, sceneId: moved.sceneId,
      expectedRevision: moved.revision, expression: { ids: [target.id] }, mode: 'set' });
    assert.equal(movedSelection.selectedCount, 1);
    assert.equal(plugin.managers.structure.selection.stats.elementCount, 1);
    const stale = await agent.run({ command: 'measureGeometry', args: { selectionVersion: 1,
      sceneId: initial.sceneId, expectedRevision: initial.revision, measurement: 'distance', atomIds: [stationary.id, target.id] } });
    assert.equal(stale.error.code, 'STALE_REVISION');
    const fullGroup = await run('queryGroups', groupArgs);
    await run('selectAtoms', { selectionVersion: 1, sceneId: fullGroup.sceneId, expectedRevision: fullGroup.revision,
      expression: targetGroup.groupExpression, mode: 'set' });
    assert.equal(plugin.managers.structure.selection.stats.elementCount, 4);
    assert.equal(plugin.managers.structure.selection.getLoci(structures[0].data).elements.length, 0);
    await plugin.state.data.build().delete(transform).commit();
    assert.equal((await query({ fields: { structureId: structures[1].ref, atom_id: 17 } })).atoms[0].position[0], 0);
    agent.detach();
    plugin.canvas3d = originalCanvas;
  } finally {
    agent?.detach();
    plugin.canvas3d = undefined;
    plugin.dispose();
    dom.close();
    globalThis.document = previousDocument;
  }
});
