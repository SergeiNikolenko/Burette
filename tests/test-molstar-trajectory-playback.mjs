import assert from 'node:assert/strict';
import { BuretteTrajectoryPlayback } from '../scripts/molstar-trajectory-playback.js';
import { PluginAnimationManager } from 'molstar/lib/mol-plugin-state/manager/animation.js';
import { PluginStateObject } from 'molstar/lib/mol-plugin-state/objects.js';

// The real Mol* manager + Burette animation; only the expensive state update is
// a deferred command. This specifically covers stop() while applyFrame awaits.
function fixture(count = 148, initial = 60) {
  let index = initial, finish;
  const frames = [], errors = [], hover = [];
  const model = { transform: { ref: 'model' } };
  const parent = { obj: new PluginStateObject.Molecule.Trajectory({ frameCount: count }) };
  const state = {
    select: () => [model],
    tree: { transforms: new Map([['model', { ref: 'model', parent: 'trajectory' }], ['trajectory', { ref: 'trajectory', parent: '' }]]) },
    cells: new Map([['model', { obj: { type: {} } }], ['trajectory', parent]]),
    build: () => {
      let next;
      return { to() { return this; }, update(fn) { next = fn({ modelIndex: index }); return this; },
        commit() { index = next.modelIndex; frames.push(index); } };
    }
  };
  const plugin = { state: { data: state }, log: { error: e => errors.push(e) },
    behaviors: { state: { isAnimating: { value: false, next(value) { this.value = value; } } } },
    commands: { dispatch: (_cmd, { tree }) => new Promise((resolve, reject) => {
      finish = (fail = false) => { if (fail) reject(new Error('frame failed')); else { tree.commit(); resolve(); } };
    }) }
  };
  const manager = new PluginAnimationManager(plugin);
  const controller = BuretteTrajectoryPlayback.forPlugin(plugin);
  controller.configure({ modelRef: 'model', beforeFrame: () => hover.push(index), onError: e => errors.push(e.message) });
  const params = { mode: { name: 'loop', params: { direction: 'forward' } },
    duration: { name: 'sequential', params: { maxFps: 20 } } };
  return { manager, controller, params, frames, errors, hover, complete: fail => finish(fail),
    get index() { return index; }, set index(value) { index = value; } };
}
const f = fixture();
await f.manager.play(f.controller.animation, f.params);
const inFlight = f.manager.tick(0, true);
await Promise.resolve();
let drained = false;
const stop = f.manager.stop().then(() => { drained = true; });
await Promise.resolve();
assert.equal(drained, false, 'stop must await the old coordinate update');
f.complete();
await Promise.all([inFlight, stop]);
assert.deepEqual(f.frames, [61], 'start continues at the actual index, never zero');
f.index = 90; // seek is safe after awaited stop
await f.manager.tick(999, true);
assert.equal(f.index, 90);
await f.manager.play(f.controller.animation, f.params);
const resumed = f.manager.tick(1000, true);
await Promise.resolve();
f.complete(); await resumed;
assert.equal(f.index, 91, 'resume and speed changes must not reset to zero');
assert.equal(f.hover.length, 4, 'clear transient hover before and after both frames');
const failing = f.manager.tick(1100, true);
await Promise.resolve();
f.complete(true); await failing; await f.manager.stop();
assert.deepEqual(f.errors, ['frame failed']);
assert.equal(f.manager.isAnimating, false);
assert.equal(f.index, 91);

// Drive the actual apply with reproducible render timings, not wall-clock tests.
const g = fixture();
let now = 0;
const originalNow = performance.now;
performance.now = () => now;
try {
  await g.manager.play(g.controller.animation, { ...g.params, duration: { name: 'sequential', params: { maxFps: 2000 } } });
  for (let i = 0; i < 149; i++) {
    const tick = g.manager.tick(i * 185, true);
    await Promise.resolve();
    now += 185;
    g.complete(); await tick;
  }
  assert.equal(g.frames[0], 61);
  assert.equal(new Set(g.frames.slice(1)).size, 148, 'overload must not revisit only 2 or 4 frames');
  await g.manager.stop();
} finally { performance.now = originalNow; }
console.log('real Mol* manager: drain, resume, hover, failed update, 148-frame overload traversal passed');

const fastRender = fixture(501, 0);
await fastRender.manager.play(fastRender.controller.animation, {
  ...fastRender.params, duration: { name: 'sequential', params: { maxFps: 120 } }
});
for (let i = 0; i < 61; i++) {
  const tick = fastRender.manager.tick(i * 1000 / 60, true);
  await Promise.resolve();
  fastRender.complete(); await tick;
}
assert.ok(fastRender.index >= 119 && fastRender.index <= 122, '120 source FPS must not cap at 60 redraw FPS');
await fastRender.manager.stop();
console.log('fast renderer / 60Hz clock maintains 120 target source FPS');

const removed = fixture();
let finished = false;
removed.controller.configure({ modelRef: 'removed-model', beforeFrame() {}, onError: e => { throw e; }, onFinished: () => { finished = true; } });
await removed.manager.play(removed.controller.animation, removed.params);
await removed.manager.tick(0, true);
assert.equal(removed.index, 60, 'a different trajectory must not be animated');
assert.equal(finished, true, 'finished must notify the viewer, not leave Stop showing');
await removed.manager.stop();
