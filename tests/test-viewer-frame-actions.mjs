import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const start = source.indexOf('  async function controlFramesFromAction(');
const end = source.indexOf('  async function setStructurePoseFromAction(', start);
function fixture() {
  let index = 0, playing = false;
  const control = {
    snapshot: () => ({ kind: 'frame', frameIndex: index, frameCount: 3, playing }),
    play: () => { playing = true; }, stop: () => { playing = false; },
    setFrame: async value => { index = value; },
  };
  const context = { activeTrajectoryPlaybackControl: control, agentActionFailure: (command, code, message) => ({ ok: false, command, error: { code, message } }) };
  const run = runInNewContext(source.slice(start, end) + '\ncontrolFramesFromAction', context);
  return { run: async action => structuredClone(await run(action)), context, control };
}
test('agent timeline controls share current frame, playback, and validated bounds', async () => {
  const { run } = fixture();
  for (const [operation, index, frameIndex, playing] of [['next', undefined, 1, false], ['play', undefined, 1, true], ['goto', 2, 2, false], ['previous', undefined, 1, false], ['pause', undefined, 1, false]]) {
    assert.deepEqual(await run({ type: 'control_frames', operation, index }), { ok: true, command: 'control_frames', result: { kind: 'frame', frameIndex, frameCount: 3, playing } });
  }
  for (const index of [-1, 3, 1.5, '1']) assert.equal((await run({ type: 'control_frames', operation: 'goto', index })).error.code, 'INVALID_FRAME');
  assert.equal((await run({ type: 'control_frames', operation: 'unknown' })).error.code, 'INVALID_ARGS');
  assert.equal((await run({ type: 'observe_frames' })).result.frameIndex, 1);
});
test('missing and replaced timelines fail closed', async () => {
  const { run, context, control } = fixture();
  control.setFrame = async () => { context.activeTrajectoryPlaybackControl = null; };
  assert.equal((await run({ type: 'control_frames', operation: 'next' })).error.code, 'STALE_TARGET');
  assert.equal((await run({ type: 'observe_frames' })).error.code, 'NO_FRAME_CONTROLS');
});
