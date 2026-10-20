import assert from 'node:assert/strict';
import { BuretteResizeInteraction as interaction } from '../scripts/molstar-resize-interaction.js';

const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
const timers = new Map();
let serial = 0;
globalThis.setTimeout = callback => { timers.set(++serial, callback); return serial; };
globalThis.clearTimeout = id => timers.delete(id);
function fixture() {
  let resizes = 0;
  const canvas = { width: 1600, height: 1200, style: { width: '800px', height: '600px', transform: '', left: '', top: '', maxWidth: '', position: '', pointerEvents: '' } };
  const context = { canvas, props: { resolutionMode: 'native', pixelScale: 1.5 }, setProps() { throw Error('resize must not change quality preferences'); } };
  const scientific = { coordinates: [1, 2, 3], frame: 7, camera: { radius: 42 } };
  const plugin = { canvas3dContext: context, handleResize() { resizes++; } };
  return { viewer: { plugin, scientific }, plugin, canvas, scientific, resizes: () => resizes };
}
function settle() { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); }
try {
  const f = fixture();
  const originalStyle = { ...f.canvas.style }, originalResize = f.plugin.handleResize;
  const finished = [];
  for (let i = 0; i < 180; i++) {
    assert.equal(interaction.touch(f.viewer, stats => { f.plugin.handleResize(); finished.push(stats); }), true);
    f.plugin.handleResize(); // Mol* input/layout paths share the deferral.
    interaction.record(f.viewer, i);
    assert.equal(timers.size, 1);
  }
  assert.equal(f.resizes(), 0, 'continuous geometry never reallocates or clears the buffer');
  assert.deepEqual([f.canvas.width, f.canvas.height], [1600, 1200]);
  assert.deepEqual([f.canvas.style.width, f.canvas.style.height, f.canvas.style.left, f.canvas.style.transform], ['auto', '100%', '50%', 'translateX(-50%)']);
  settle();
  assert.equal(f.resizes(), 1, 'one exact resize after geometry settles');
  assert.equal(f.plugin.handleResize, originalResize);
  assert.deepEqual(f.canvas.style, originalStyle);
  assert.deepEqual(f.scientific, { coordinates: [1, 2, 3], frame: 7, camera: { radius: 42 } });
  assert.deepEqual(finished, [{ frames: 120, p95Ms: 173, maxMs: 179 }]);

  const changed = fixture();
  interaction.touch(changed.viewer, () => {});
  changed.canvas.style.transform = 'translateX(-40%)';
  const newerResize = changed.plugin.handleResize = () => {};
  settle();
  assert.equal(changed.canvas.style.transform, 'translateX(-40%)');
  assert.equal(changed.plugin.handleResize, newerResize, 'newer ownership must survive restoration');

  const disposed = fixture(), disposeResize = disposed.plugin.handleResize;
  interaction.touch(disposed.viewer, () => { throw Error('disposed viewer must not be drawn'); });
  interaction.dispose(disposed.viewer); settle();
  assert.equal(timers.size, 0);
  assert.equal(disposed.plugin.handleResize, disposeResize);
  assert.equal(disposed.canvas.style.width, '800px');
  assert.equal(interaction.touch({ plugin: { canvas3dContext: { canvas: { width: 0 } } } }, () => {}), false);
} finally {
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
}
console.log('resize reuses GL buffers, preserves projection and scientific state, settles once and releases ownership');
