import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const extract = name => source.match(new RegExp(`\\n  (?:async )?function ${name}\\([\\s\\S]*?\\n  \\}`, 'u'))[0];

// A hidden frame uses the timeout; returning to it must not run a backlog of
// already-completed paint waits. Exercise both possible rAF stages and a paint.
for (const mode of ['hidden', 'hidden-after-first-frame', 'visible']) {
  let id = 0;
  const frames = new Map(), timers = new Map();
  const window = {
    requestAnimationFrame: fn => (frames.set(++id, fn), id),
    cancelAnimationFrame: key => frames.delete(key),
    setTimeout: fn => (timers.set(++id, fn), id),
    clearTimeout: key => timers.delete(key),
  };
  const fire = queue => { const [key, fn] = queue.entries().next().value; queue.delete(key); fn(); };
  const waitForPaint = new Function('window', `${extract('nextMolstarPaint')} return nextMolstarPaint;`)(window);
  for (let i = 0; i < 25; i++) {
    const pending = waitForPaint();
    if (mode !== 'hidden') fire(frames);
    fire(mode === 'visible' ? frames : timers);
    await pending;
    assert.deepEqual([frames.size, timers.size], [0, 0], mode);
  }
}

// Fail at each phase of a multi-pose restyle, then retry. An error must not
// stamp the cache as successful or skip recovery of partially changed geometry.
for (const failureStage of [1, 2, 3]) {
  let calls = 0, fail = true;
  const state = { key: 'loaded', poseRefs: [['a'], ['b'], ['c']], poseStyles: ['', 'backdrop', ''], visible: [true] };
  const work = async () => { if (++calls === failureStage && fail) throw new Error('build failed'); };
  const style = new Function('applySdfCollectionMolstarStyle', 'applyMolstarWaterLineRepresentation', `
    const dockingSceneStructuresByPose = (_viewer, refs) => refs;
    const normalizeMolstarStyle = value => value;
    ${extract('styleDockingScenePoses')}
    return styleDockingScenePoses;
  `)(work, work);
  const wanted = ['backdrop', '', undefined];
  await assert.rejects(style({}, state, wanted, {}), /build failed/);
  assert.deepEqual({ key: state.key, styles: state.poseStyles, visible: state.visible },
    { key: null, styles: ['', 'backdrop', ''], visible: null });
  fail = false; calls = 0;
  await style({}, state, wanted, {});
  assert.equal(calls, 3, 'retry performs all required phases');
  assert.deepEqual(state.poseStyles, ['backdrop', '', '']);
  await style({}, state, wanted, {});
  assert.equal(calls, 3, 'successful unchanged styles are reused');
}
// Nested batch failure must release both the progress state and draw hold.
const drawCalls = [];
const canvas = { pause: () => drawCalls.push('pause'), commit: () => drawCalls.push('commit'), animate: () => drawCalls.push('animate') };
const hold = new Function(`
  let molstarDrawHoldDepth = 0, molstarDrawHoldEndedAt = 0, busy = 0;
  const performance = { now: () => 0 };
  const beginMolstarBusy = () => busy++;
  const endMolstarBusy = () => busy--;
  ${extract('withMolstarDrawHold')}
  return {run:withMolstarDrawHold, state:()=>({depth:molstarDrawHoldDepth,busy})};
`)();
const viewer = { plugin: { canvas3d: canvas } };
await assert.rejects(hold.run(viewer, () => hold.run(viewer, () => { throw new Error('failed batch'); })), /failed batch/);
assert.deepEqual(drawCalls, ['pause', 'commit', 'animate']);
assert.deepEqual(hold.state(), { depth: 0, busy: 0 });
console.log('Hidden-frame cleanup, scene-style recovery and failed batch release passed');
