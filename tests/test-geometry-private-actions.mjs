import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const session = await mkdtemp(join(tmpdir(), 'burette-geometry-private-'));
const cli = (...args) => {
  const result = spawnSync(process.execPath, ['scripts/burette-agent.mjs', ...args], { encoding: 'utf8' });
  return { status: result.status, body: JSON.parse(result.stdout || result.stderr) };
};
try {
  assert.equal(cli('open', '--mode', 'desktop-app', '--session-dir', session, '--no-launch', 'samples/mini.pdb').status, 0);
  const actions = join(session, 'actions.json'), before = await readFile(actions, 'utf8');
  for (const action of [
    { type: 'geometry_binding', label: 'Geometry', notify: false },
    { type: 'update_geometry', text: '1\n\nH 0 0 0\n', lease: 'foreign', label: 'Geometry', notify: false },
  ]) {
    const result = cli('act', '--session-dir', session, JSON.stringify(action));
    assert.notEqual(result.status, 0);
    assert.equal(result.body.ok, false);
    assert.match(result.body.error.message, /Unsupported workspace action type:/);
    assert.equal(await readFile(actions, 'utf8'), before, 'private actions never enter public session history');
  }
  console.log('Private Geometry read/write actions remain outside the public CLI contract.');
} finally {
  const result = spawnSync('/usr/bin/trash', [session], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr);
}
