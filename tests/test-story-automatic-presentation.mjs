import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAutomaticStoryPresentation } from '../scripts/molstar-story-presentation.mjs';

function setup() {
  const calls = [];
  const snapshot = { id: 'step', data: { tree: { transforms: [
    { ref: 'root', transformer: 'root' },
    { ref: 'structure', parent: 'root', transformer: 'structure' },
    { ref: 'representation', parent: 'structure', transformer: 'ms-plugin.structure-representation-3d' },
    { ref: 'overpaint', parent: 'representation', transformer: 'overpaint' },
  ] } }, camera: { current: { target: [1, 2, 3] } }, canvas3d: { props: { old: true } } };
  const settings = { preset: 'automatic', appearance: 'illustrative' };
  const built = { tree: { transforms: [{ ref: 'standard-auto' }] } };
  const plugin = {
    state: { async setSnapshot(value) { calls.push(['snapshot', value]); }, data: { getSnapshot: () => built } },
    managers: { snapshot: { state: { entries: [{ snapshot }] } } },
    canvas3d: { pause: () => calls.push(['pause']), resume: () => calls.push(['resume']), requestDraw: () => calls.push(['draw']) },
  };
  const presentation = {
    settings: () => settings,
    appearance: async value => calls.push(['appearance', value]),
    automatic: async () => calls.push(['auto']),
    camera: async value => calls.push(['camera', value]),
  };
  const original = plugin.state.setSnapshot;
  const dispose = installAutomaticStoryPresentation(plugin, presentation);
  return { plugin, snapshot, calls, presentation, settings, built, dispose, original };
}

test('first frame uses actual Auto, preserves source, and builds no discarded geometry', async () => {
  const x = setup();
  const before = structuredClone(x.snapshot);
  await x.plugin.state.setSnapshot(x.snapshot);
  assert.deepEqual(x.calls.map(c => c[0]), ['pause', 'snapshot', 'appearance', 'auto', 'camera', 'resume', 'draw']);
  const loaded = x.calls[1][1];
  assert.deepEqual(loaded.data.tree.transforms.map(t => t.ref), ['root', 'structure']);
  assert.equal(loaded.canvas3d, undefined);
  assert.equal(loaded.camera, undefined);
  assert.deepEqual(x.snapshot, before);
  x.calls.length = 0;
  await x.plugin.state.setSnapshot(x.snapshot);
  assert.equal(x.calls.some(c => c[0] === 'auto'), false);
  assert.equal(x.calls.find(c => c[0] === 'snapshot')[1].data, x.built);
});

test('appearance change invalidates cache; non-Story and explicit presets are untouched', async () => {
  const x = setup();
  await x.plugin.state.setSnapshot(x.snapshot);
  x.settings.appearance = 'default';
  await x.plugin.state.setSnapshot(x.snapshot);
  assert.equal(x.calls.filter(c => c[0] === 'auto').length, 2);
  x.calls.length = 0;
  x.settings.preset = 'ball-and-stick';
  await x.plugin.state.setSnapshot(x.snapshot);
  await x.plugin.state.setSnapshot({ id: 'not-a-story' });
  assert.deepEqual(x.calls, [['snapshot', x.snapshot], ['snapshot', { id: 'not-a-story' }]]);
  x.dispose();
  assert.equal(x.plugin.state.setSnapshot, x.original);
});

test('failed preset resumes drawing and does not poison later steps', async () => {
  const x = setup();
  x.presentation.automatic = async () => { throw new Error('preset failed'); };
  await assert.rejects(x.plugin.state.setSnapshot(x.snapshot), /preset failed/);
  assert.deepEqual(x.calls.slice(-2), [['resume'], ['draw']]);
  x.presentation.automatic = async () => {};
  await x.plugin.state.setSnapshot(x.snapshot);
});
