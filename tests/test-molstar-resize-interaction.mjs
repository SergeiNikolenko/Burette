import assert from 'node:assert/strict';
import { BuretteResizeInteraction as interaction } from '../scripts/molstar-resize-interaction.js';

const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
const timers = new Map();
let serial = 0;
globalThis.setTimeout = callback => { timers.set(++serial, callback); return serial; };
globalThis.clearTimeout = id => timers.delete(id);
function fixture(contextProps = { resolutionMode: 'native', pixelScale: 1.5 }) {
  const calls = [];
  const context = { props: { ...contextProps }, setProps(props) { calls.push(['context', props]); Object.assign(this.props, props); } };
  const canvas = { props: { multiSample: { mode: 'temporal', sampleLevel: 3 } }, setProps(props) { calls.push(['canvas', props]); Object.assign(this.props.multiSample, props.multiSample); } };
  const scientific = { coordinates: [1, 2, 3], frame: 7, camera: { radius: 42 } };
  return { viewer: { plugin: { canvas3dContext: context, canvas3d: canvas }, scientific }, context, canvas, scientific, calls };
}
function settle() { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); }
try {
  const f = fixture();
  const finished = [];
  for (let i = 0; i < 180; i++) {
    interaction.touch(f.viewer, stats => finished.push(stats));
    interaction.record(f.viewer, i);
    assert.equal(timers.size, 1, 'continuous resize never restores quality between frames');
  }
  assert.deepEqual(f.context.props, { resolutionMode: 'scaled', pixelScale: 1 });
  assert.deepEqual(f.canvas.props.multiSample, { mode: 'off', sampleLevel: 3 });
  assert.equal(f.calls.length, 2, 'quality changes once per gesture, not once per resize');
  settle();
  assert.deepEqual(f.context.props, { resolutionMode: 'native', pixelScale: 1.5 });
  assert.deepEqual(f.canvas.props.multiSample, { mode: 'temporal', sampleLevel: 3 });
  assert.deepEqual(f.scientific, { coordinates: [1, 2, 3], frame: 7, camera: { radius: 42 } });
  assert.deepEqual(finished, [{ frames: 120, p95Ms: 173, maxMs: 179 }]);

  const low = fixture({ resolutionMode: 'scaled', pixelScale: 0.5 });
  interaction.touch(low.viewer, () => {}); settle();
  assert.deepEqual(low.context.props, { resolutionMode: 'scaled', pixelScale: 0.5 });

  const changed = fixture();
  interaction.touch(changed.viewer, () => {});
  changed.context.setProps({ resolutionMode: 'native', pixelScale: 0.25 });
  changed.canvas.setProps({ multiSample: { mode: 'on' } });
  settle();
  assert.deepEqual(changed.context.props, { resolutionMode: 'native', pixelScale: 0.25 });
  assert.equal(changed.canvas.props.multiSample.mode, 'on', 'a newer explicit preference wins over the saved gesture state');

  const disposed = fixture();
  interaction.touch(disposed.viewer, () => { throw Error('disposed viewer must not be touched'); });
  interaction.dispose(disposed.viewer); settle();
  assert.equal(timers.size, 0);
} finally {
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
}
console.log('interactive resize keeps scientific state and restores quality, bounded diagnostics and disposal');
