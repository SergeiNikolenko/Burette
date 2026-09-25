#!/usr/bin/env bun
// set_burette_trajectory must reject frames that do not exist. The UI pose
// setter clamps, so index 2 on a two-frame file used to answer ok while the
// viewer stayed on frame 2/2 (index 1).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const slice = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `viewer.js no longer contains ${start}`);
  return source.slice(from, to);
};
const helpers = [
  slice('  function agentActionFailure(command, code, message) {', '  function renderBuretteAgentPanel(action) {'),
  slice('  // The pose setters clamp for UI steps;', '  function currentTrajectoryPlaybackSnapshot() {'),
].join('\n');
const requested = [];
const setStructurePose = new Function('activeStructurePoseSetter', 'activeTrajectoryPlaybackControl',
  `${helpers}; return setStructurePoseFromAction;`)(
  async index => { requested.push(index); },
  { frameCount: () => 2 },
);

for (const index of [0, 1]) {
  assert.deepEqual(await setStructurePose({ index }), { ok: true, command: 'set_structure_pose', result: { index } });
}
for (const index of [2, 7, -1]) {
  const result = await setStructurePose({ index });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INDEX_OUT_OF_RANGE');
  assert.match(result.error.message, new RegExp(`Frame index ${index} is out of range; this structure has 2 frames \\(valid indices 0–1\\)`));
}
assert.deepEqual(requested, [0, 1], 'Out-of-range requests never reach the clamping pose setter');

// The SDF pose/molecule paths validate against their own pose count.
assert.match(source, /const outOfRange = agentFrameIndexFailure\('set_sdf_pose_index', index, poseCount\);\s*if \(outOfRange\) return outOfRange;/);
assert.match(source, /const outOfRange = agentFrameIndexFailure\('set_sdf_molecule', index, poseCount\);\s*if \(outOfRange\) return outOfRange;/);
console.log('Agent trajectory frame index contracts passed');
