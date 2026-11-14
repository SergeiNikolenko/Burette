import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { writeAgentSessionJson } from '../scripts/agent-session-atomic-file.mjs';

test('concurrent session readers see complete documents throughout replacement', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'burette-session-atomic-'));
  const path = resolve(directory, 'actions.json');
  const payload = 'x'.repeat(256 * 1024);
  let done = false;
  let observations = 0;
  try {
    await writeAgentSessionJson(path, { generation: 0, payload });
    const reader = async () => {
      while (!done) {
        const value = JSON.parse(await readFile(path, 'utf8'));
        assert.ok(Number.isInteger(value.generation));
        assert.equal(value.payload, payload);
        observations += 1;
      }
    };
    const readers = Array.from({ length: 4 }, reader);
    try {
      for (let generation = 1; generation <= 100; generation += 1) {
        await writeAgentSessionJson(path, { generation, payload });
      }
    } finally {
      done = true;
      await Promise.all(readers);
    }
    assert.ok(observations >= 4);
    assert.equal(JSON.parse(await readFile(path, 'utf8')).generation, 100);
    assert.deepEqual(await readdir(directory), ['actions.json']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('failed serialization leaves the previous session and no temporary file', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'burette-session-atomic-failure-'));
  const path = resolve(directory, 'observe.json');
  try {
    await writeAgentSessionJson(path, { revision: 7 });
    await assert.rejects(writeAgentSessionJson(path, { invalid: 1n }), TypeError);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { revision: 7 });
    assert.deepEqual(await readdir(directory), ['observe.json']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
