import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { InteractivityManager } = require('molstar/lib/commonjs/mol-plugin-state/manager/interactivity.js');
const { MarkerAction } = require('molstar/lib/commonjs/mol-util/marker-action.js');
const { EveryLoci } = require('molstar/lib/commonjs/mol-model/loci.js');
const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const extract = name => {
  const match = source.match(new RegExp(`\\n  (?:async )?function ${name}\\([\\s\\S]*?\\n  \\}`, 'u'));
  assert.ok(match, `missing ${name}`);
  return match[0];
};

// Real Mol* highlight manager, with a representation that stops accepting old
// loci after a frame swap. Clearing after the swap leaves its marker stranded.
let highlighted = false;
let frame = 0;
let selected = true;
let painted = 0;
const plugin = { managers: { structure: { selection: {} }, interactivity: {} }, state: { data: {} } };
const highlights = new InteractivityManager.LociHighlightManager(plugin);
plugin.managers.interactivity.lociHighlights = highlights;
plugin.managers.interactivity.lociSelects = { deselectAll() { selected = false; } };
highlights.addProvider((_loci, action) => {
  if (frame !== 0) return;
  if (action === MarkerAction.Highlight) highlighted = true;
  if (action === MarkerAction.RemoveHighlight) highlighted = false;
});
const transform = { plugin, frameCount: 20, ref: 'model', params: { modelIndex: 0 } };
plugin.state.updateTransform = async (_data, ref, params) => {
  assert.equal(ref, 'model');
  assert.equal(highlighted, false, 'outgoing hover must be removed before replacing the model');
  frame = params.modelIndex;
  highlighted = true; // Simulate a hover arriving while the async update was busy.
};
const clearHover = new Function('window', `${extract('clearMolstarTrajectoryHover')}; return clearMolstarTrajectoryHover;`)({ molstar: { lib: { loci: { EveryLoci } } } });
plugin.canvas3d = { mark({ loci }, action) {
  assert.equal(loci, EveryLoci);
  assert.equal(action, MarkerAction.RemoveHighlight, 'never clear explicit selections');
  highlighted = false;
} };
const direct = new Function('nativeTrajectoryModelTransform', 'afterNativeTrajectoryPaint', 'clearMolstarTrajectoryHover', `${extract('setNativeTrajectoryPoseDirect')}; return setNativeTrajectoryPoseDirect;`)(
  () => transform, async () => { assert.equal(highlighted, false, "late hover clears before painting, even if playback stops now"); painted++; }, clearHover,
);
highlights.highlightOnly({ loci: EveryLoci }, false);
assert.equal(highlighted, true);
assert.equal(await direct(5, 20), true);
assert.deepEqual({ frame, highlighted, selected, painted }, { frame: 5, highlighted: false, selected: true, painted: 1 });
highlights.clearHighlights();
assert.equal(highlighted, false, 'leaving the viewport after the update cannot leave a stale marker');

// The legacy step-button route follows the same lifecycle without clearing the
// user's explicit atom selection.
frame = 0;
highlights.highlightOnly({ loci: EveryLoci }, false);
const step = new Function('setNativeTrajectoryPoseDirect', 'readNativeTrajectoryPosition', 'nativeTrajectoryStepButton', 'afterNativeTrajectoryPaint', 'activeViewer', 'clearMolstarTrajectoryHover', `${extract('setNativeTrajectoryPose')}; return setNativeTrajectoryPose;`)(
  async () => false, () => ({ index: 0 }),
  () => ({ disabled: false, getAttribute: () => null, click() { assert.equal(highlighted, false); frame++; } }),
  async () => {}, { plugin }, clearHover,
);
assert.equal(await step(1, 20), true);
assert.deepEqual({ frame, highlighted, selected }, { frame: 1, highlighted: false, selected: true });
// A late hover keeps an old model reference after it has been replaced.
frame = 0;
highlights.highlightOnly({ loci: EveryLoci }, false);
frame = 2;
highlights.clearHighlights();
assert.equal(highlighted, true, 'model-bound cleanup alone cannot remove the stale marker');
clearHover(plugin);
assert.deepEqual({ highlighted, selected }, { highlighted: false, selected: true });
console.log('Trajectory hover lifecycle passed: outgoing markers clear before direct and fallback frame changes; selection survives.');
