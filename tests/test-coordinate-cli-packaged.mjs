import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Execute the actual shipped script tree outside the repository, without module fallbacks.
const source = resolve('plugins/burette-agent/scripts');
const target = await mkdtemp(join(tmpdir(), 'coordinate-packaged-'));
try {
  await cp(source, join(target, 'scripts'), { recursive: true, dereference: false });
  for (const test of ['test-molecular-coordinates.mjs', 'test-coordinate-cli-lossless.mjs']) {
    const result = spawnSync(process.execPath, [resolve('tests', test), join(target, 'scripts/burette-agent.mjs')],
      { cwd: target, env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' }, encoding: 'utf8', timeout: 60000, maxBuffer: 65536 });
    assert.ifError(result.error); assert.equal(result.status, 0, result.stderr || result.stdout);
    process.stdout.write(result.stdout);
  }
  console.log('Isolated packaged coordinate CLI passed without repository runtime imports.');
} finally { await rm(target, { recursive: true, force: true }); }
