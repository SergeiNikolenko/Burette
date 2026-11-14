import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

test('concurrent session GETs remain valid during HTTP PUTs', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'burette-session-http-'));
  const listener = createServer();
  await new Promise(done => listener.listen(0, '127.0.0.1', done));
  const port = listener.address().port;
  await new Promise(done => listener.close(done));
  const script = process.env.BURETTE_AGENT_SESSION_SERVER || resolve('scripts/agent-shell-server.mjs');
  const child = spawn(process.execPath, [script, '--dist', directory, '--session-dir', directory,
    '--allow', directory, '--host', '127.0.0.1', '--port', String(port)], { stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}`;
  let done = false;
  const failures = [];
  let observations = 0;
  try {
    await writeFile(resolve(directory, 'index.html'), '<title>Session transport fixture</title>');
    const payload = 'x'.repeat(512 * 1024);
    await writeFile(resolve(directory, 'actions.json'), JSON.stringify({ revision: 0, payload }));
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        ready = (await fetch(url + '/healthz')).ok;
        if (ready) break;
      } catch {}
      assert.equal(child.exitCode, null, 'server exited before readiness');
      await new Promise(resolveWait => setTimeout(resolveWait, 25));
    }
    assert.ok(ready);
    const read = async () => {
      while (!done) {
        const response = await fetch(url + '/__burette/agent-session/actions.json');
        const value = await response.json();
        if (response.status !== 200) {
          failures.push({ status: response.status, value });
          return;
        }
        assert.equal(value.payload, payload);
        assert.ok(Number.isInteger(value.revision));
        observations += 1;
      }
    };
    const readers = Array.from({ length: 4 }, read);
    try {
      for (let revision = 1; revision <= 80; revision += 1) {
        const response = await fetch(url + '/__burette/agent-session/actions.json', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revision, payload }),
        });
        assert.equal(response.status, 200);
        await response.arrayBuffer();
      }
    } finally {
      done = true;
      await Promise.all(readers);
    }
    assert.deepEqual(failures, []);
    assert.ok(observations >= 4);
  } finally {
    child.kill('SIGTERM');
    if (child.exitCode === null) await new Promise(resolveExit => child.once('exit', resolveExit));
    await rm(directory, { recursive: true, force: true });
  }
});
