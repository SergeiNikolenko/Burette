import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('real Mol* conditional admission rejects before scene and undo bookkeeping', () => {
  // Fresh module cache ensures the exact production build adaptation is loaded
  // before Mol*, even when other tests already imported the unadapted package.
  const result = spawnSync('bun', ['--preload', './tests/fixtures/molstar-state-preload.mjs', './tests/fixtures/molstar-conditional-state.mjs'], {
    cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 15000, maxBuffer: 65536,
  });
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
  assert.match(result.stdout, /complete undo order/);
});
