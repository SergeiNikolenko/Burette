import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { PluginContext } from 'molstar/lib/mol-plugin/context.js';
import { DefaultPluginSpec } from 'molstar/lib/mol-plugin/spec.js';
import { PluginStateTransform, PluginStateObject as SO } from 'molstar/lib/mol-plugin-state/objects.js';
import { StateTransforms } from 'molstar/lib/mol-plugin-state/transforms.js';
import { Task } from 'molstar/lib/mol-task/index.js';

const dom = new Window();
globalThis.document = dom.document;
const plugin = new PluginContext(DefaultPluginSpec());
try {
  await plugin.init();
  const state = plugin.state.data;
  assert.equal(state.burettePreconditionVersion, 1);
  const raw = label => state.build().toRoot().apply(StateTransforms.Data.RawData, { data: label, label });
  for (let i = 1; i <= 5; i++) await raw(String(i)).commit({ canUndo: String(i) });
  let started, release;
  const hasStarted = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const Hold = PluginStateTransform.BuiltIn({ name: 'conditional-test-hold', from: SO.Root, to: SO.Data.String })({
    apply: () => Task.create('Hold test queue', async () => { started(); await gate; return new SO.Data.String('held'); }),
  });
  let revision = 0;
  const subscription = state.events.changed.subscribe(() => { revision++; });
  const expected = revision;
  const holding = state.build().toRoot().apply(Hold).commit({ canUndo: 'Hold' });
  await hasStarted;
  const pending = raw('Rejected');
  const failures = Array.from({ length: 3 }, (_, i) => assert.rejects(plugin.runTask(state.updateTree(i ? raw(`Rejected-${i}`) : pending, {
    canUndo: 'Must not enter undo history', revertOnError: true,
    burettePrecondition() {
      assert.equal(state.inUpdate, false);
      if (revision !== expected) throw Object.assign(new Error('Stale queue-head revision'), { code: 'STALE_REVISION' });
    },
  })), { code: 'STALE_REVISION' }));
  release();
  await holding;
  const committed = state.getSnapshot();
  await Promise.all(failures);
  assert.deepEqual(state.getSnapshot(), committed);
  assert.equal(state.cells.has(pending.ref), false);
  const undoLabels = [];
  while (state.canUndo) { undoLabels.push(state.latestUndoLabel); await plugin.runTask(state.undo()); }
  assert.deepEqual(undoLabels, ['Hold', '5', '4', '3', '2']);
  const valid = raw('Accepted');
  let checked = false;
  await plugin.runTask(state.updateTree(valid, { canUndo: 'Accepted', burettePrecondition() { checked = true; } }));
  assert.equal(checked, true);
  assert.equal(state.cells.get(valid.ref).obj.data, 'Accepted');
  subscription.unsubscribe();
  console.log('Queue-head preconditions preserve scene and complete undo order on rejection; queue remains usable.');
} finally {
  plugin.dispose(); dom.close(); delete globalThis.document;
}
