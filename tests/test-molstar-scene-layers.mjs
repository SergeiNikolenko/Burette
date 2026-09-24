import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('real Mol* owned layer patches preserve foreign state, visibility and one Undo', () => {
  const child = spawnSync('bun', ['--preload', './tests/fixtures/molstar-state-preload.mjs', './tests/fixtures/molstar-scene-layers.mjs'],
    { cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 30000, maxBuffer: 65536 });
  assert.equal(child.status, 0, `${child.error || ''}\n${child.stdout}\n${child.stderr}`);
  assert.match(child.stdout, /Scene layer contracts passed/);
});
