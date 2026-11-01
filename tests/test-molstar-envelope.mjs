import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { PluginContext } from '@molstar/plugin/context';
import { DefaultPluginSpec } from '@molstar/plugin/default-spec';

const dom = new Window();
const previousDocument = globalThis.document;
globalThis.document = dom.document;
const plugin = new PluginContext({ ...DefaultPluginSpec(), behaviors: [] });
try {
  await plugin.init();
  const data = await plugin.builders.data.rawData({ data: readFileSync(new URL('../samples/mini.cif', import.meta.url), 'utf8') });
  const trajectory = await plugin.builders.structure.parseTrajectory(data, 'mmcif');
  const model = await plugin.builders.structure.createModel(trajectory);
  const structure = await plugin.builders.structure.createStructure(model);
  const component = await plugin.builders.structure.tryCreateComponentStatic(structure, 'all');
  const envelope = await plugin.builders.structure.representation.addRepresentation(component, {
    type: 'blob-surface', typeParams: { blobSize: 12, alpha: 0.6 }, color: 'chain-id',
  });
  assert.equal(envelope.cell.status, 'ok');
  const mesh = envelope.obj.data.repr.renderObjects;
  assert.ok(mesh.length > 0, 'Envelope must create renderable geometry for a real mmCIF');
  assert.ok(mesh.some(object => object.values.drawCount.ref.value > 0), 'Envelope mesh must contain triangles');
  const before = JSON.parse(JSON.stringify(envelope.cell.transform.params));
  const snapshot = JSON.parse(JSON.stringify(plugin.state.data.getSnapshot()));
  await plugin.clear();
  await plugin.runTask(plugin.state.data.setSnapshot(snapshot));
  const restored = plugin.state.data.cells.get(envelope.ref);
  assert.equal(restored.status, 'ok');
  assert.deepEqual(restored.transform.params, before);
  assert.ok(restored.obj.data.repr.renderObjects.some(object => object.values.drawCount.ref.value > 0));

  const restoredStructure = plugin.state.data.cells.get(structure.ref).obj.data;
  const update = plugin.state.data.build().to(envelope.ref).update(old => ({
    ...old, type: { name: 'blob-surface', params: { ...old.type.params, visuals: ['blob-surface-wireframe'], blobSize: 20, alpha: 0.35 } },
  }));
  await update.commit();
  const wireframe = plugin.state.data.cells.get(envelope.ref);
  assert.equal(wireframe.status, 'ok');
  assert.equal(wireframe.transform.params.type.params.alpha, 0.35);
  assert.ok(wireframe.obj.data.repr.renderObjects.some(object => object.values.drawCount.ref.value > 0));
  assert.equal(restoredStructure, plugin.state.data.cells.get(structure.ref).obj.data, 'Editing the envelope preserves the loaded molecular structure');
  console.log('Envelope builds solid/wireframe geometry, preserves its source and reopens from a scene snapshot');
} finally {
  plugin.dispose();
  globalThis.document = previousDocument;
  await dom.happyDOM.close();
}
