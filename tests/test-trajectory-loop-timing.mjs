import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { BuretteTrajectoryPlayback } from '../scripts/molstar-trajectory-playback.js';

// Exercise the shipped scheduler, not a reimplementation of its arithmetic.
const viewer = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const sourceStart = viewer.indexOf('    const loopStride = (loopBounds) => {');
const end = viewer.indexOf('    const trajectoryPlaybackControl = {', sourceStart);
assert.ok(sourceStart > 0 && end > sourceStart);

function scheduler({ fps, count = 148, start = 0, stepMs = 200 }) {
  let now = 0;
  let timer;
  const frames = [];
  const ctx = vm.createContext({
    activePose: start, loopActive: true, loopBusy: false, loopEpoch: 1,
    loopStartedAt: 0, loopStepMs: 0, loopFrameCarry: 0, loopTimer: null,
    hostViewerVisible: true, prepared: {},
    nativeLoopAnimation: () => null,
    loopNow: () => now,
    loopDelayMs: () => 1000 / fps,
    minimumTrajectoryLoopTimerDelay: () => 16,
    trajectoryControlBounds: () => ({ start, count }),
    window: { molstar: { BuretteTrajectoryPlayback }, setTimeout: (fn, delay) => { timer = { fn, delay }; return 1; } },
    setPose: async (index) => {
      now += stepMs;
      ctx.activePose = index;
      frames.push(index);
    },
  });
  vm.runInContext(`${viewer.slice(sourceStart, end)}\nglobalThis.schedule = scheduleLoopStep;`, ctx);
  ctx.schedule();
  return {
    ctx, frames,
    async tick(lateness = 0) {
      assert.ok(timer, 'scheduler must arrange the next frame');
      const pending = timer;
      timer = null;
      now += pending.delay + lateness;
      pending.fn();
      await new Promise(resolve => setImmediate(resolve));
    },
    get scheduled() { return !!timer; },
  };
}

// Low FPS must not skip frames even when the OS timer is late.
const slow = scheduler({ fps: 2 });
for (let i = 0; i < 10; i++) await slow.tick(30);
assert.deepEqual(slow.frames, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

// Slow rendering must not cap all requested speeds at one frame per redraw.
const fast = scheduler({ fps: 20 });
for (let i = 0; i < 10; i++) await fast.tick();
assert.ok(fast.frames.at(-1) >= 36, JSON.stringify(fast.frames));
assert.equal(fast.frames[0], 1, 'first frame after start is sequential');

// Wrap within the selected segment and advance from the displayed frame.
const segment = scheduler({ fps: 60, start: 51, count: 20 });
for (let i = 0; i < 20; i++) await segment.tick();
assert.ok(segment.frames.every(frame => frame >= 51 && frame < 71));
assert.equal(new Set(segment.frames.slice(1)).size, 19, 'coprime stride must traverse the segment, not a short orbit');
for (let i = 1; i < segment.frames.length; i++) {
  const stride = (segment.frames[i] - segment.frames[i - 1] + 20) % 20;
  assert.ok(stride >= 1 && stride <= 5);
}

// Short loops remain playable; stop invalidates an already scheduled callback.
const pair = scheduler({ fps: 2000, count: 2 });
for (let i = 0; i < 4; i++) await pair.tick();
assert.deepEqual(pair.frames, [1, 0, 1, 0]);
pair.ctx.loopActive = false;
pair.ctx.loopEpoch++;
await pair.tick();
assert.equal(pair.frames.length, 4);
assert.equal(pair.scheduled, false);

console.log('trajectory loop timing tests passed (low FPS, slow renderer, segments, wrap, stop)');

// Native trajectories use a Mol* animation with an awaited teardown, never an
// absolute-time model index. Test the actual adapter independently below.
for (const count of [20, 148, 501]) {
  const step = BuretteTrajectoryPlayback.stride(count, 2000);
  const visited = new Set();
  let frame = 60 % count;
  for (let i = 0; i < count; i++) { frame = (frame + step) % count; visited.add(frame); }
  assert.equal(visited.size, count);
}
console.log('bounded overload visits every frame for a steady stride');

// Stop must use the owner captured on start, even after Align changes eligibility.
const nativeStart = viewer.indexOf('    const nativePlayback = ');
const nativeEnd = viewer.indexOf('    const loopStride = ', nativeStart);
const calls = [];
const animation = { name: 'burette.animate-trajectory' };
const manager = {
  current: { anim: animation },
  play: async () => calls.push('play'), stop: async () => calls.push('stop'),
};
const native = vm.createContext({
  window: { molstar: { BuretteTrajectoryPlayback: { forPlugin: () => ({ animation, configure() {} }) } } },
  prepared: { nativeTrajectoryControls: true }, hasTrajectorySegments: false,
  nativeTrajectoryModelTransform: () => ({ ref: 'model' }),
  viewer: { plugin: { managers: { animation: manager } } }, overlay: false,
  xyzSingleFrameSceneActive: () => native.overlay,
  loopEpoch: 0, loopActive: true, hostViewerVisible: true,
  nativeLoopQueue: Promise.resolve(), loopDelayMs: () => 50,
  clearMolstarTrajectoryHover() {}, setLoopActive() {}, setStatus: message => assert.fail(message),
});
vm.runInContext(`${viewer.slice(nativeStart, nativeEnd)}\nglobalThis.queue = queueNativeLoop;`, native);
await native.queue(true);
native.overlay = true;
await native.queue(false);
assert.deepEqual(calls, ['play', 'stop']);
native.overlay = false;
const staleStart = native.queue(true);
native.loopEpoch++;
await staleStart;
assert.deepEqual(calls, ['play', 'stop'], 'invalidated starts cannot restart the old manager');
console.log('native playback ownership survives overlay transition; stale starts rejected');

// Nested rebuilds must not resume early; the last explicit Stop wins.
const pauseStart = viewer.indexOf('  let trajectoryPlaybackIntent = ');
const pauseEnd = viewer.indexOf('\n  }', viewer.indexOf('  async function pauseTrajectoryForRebuild()', pauseStart)) + 4;
const controlsStart = viewer.indexOf('    const trajectoryPlaybackControl = {');
const controlsEnd = viewer.indexOf('    const setPose = ', controlsStart);
const pause = vm.createContext({ activeViewer: {}, activeTrajectoryPlaybackControl: null,
  loopActive: true, nativeLoopQueue: Promise.resolve(), poseUpdateQueue: Promise.resolve(),
  starts: 0, setLoopActive: value => { pause.loopActive = value; }, scheduleLoopStep: () => { pause.starts++; },
});
vm.runInContext(`${viewer.slice(pauseStart, pauseEnd)}\n${viewer.slice(controlsStart, controlsEnd)}\nglobalThis.pause = pauseTrajectoryForRebuild;`, pause);
const release1 = await pause.pause(), release2 = await pause.pause();
release1(); assert.equal(pause.starts, 0);
release2(); assert.equal(pause.starts, 1);
const release3 = await pause.pause();
pause.activeTrajectoryPlaybackControl.play(); // defer, do not animate during a rebuild
assert.equal(pause.starts, 1);
await pause.activeTrajectoryPlaybackControl.stop();
release3(); assert.equal(pause.starts, 1, 'Stop during the rebuild must suppress auto-resume');
console.log('nested rebuild pause and last-user-intent playback passed');
