#!/usr/bin/env node
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = await mkdtemp(join(tmpdir(), 'burette-cli-output-test-'));
try {
  await mkdir(join(root, 'mcp/lib'), { recursive: true });
  await mkdir(join(root, 'scripts'));
  for (const name of ['cli-bridge.mjs', 'plugin-root.mjs']) {
    await cp(`plugins/burette-agent/mcp/lib/${name}`, join(root, 'mcp/lib', name));
  }
  await writeFile(join(root, 'scripts/burette-agent.mjs'), `
    const mode = process.argv[2];
    if (mode === 'valid') {
      process.stdout.write(JSON.stringify({ ok: true, result: 'ю'.repeat(1024 * 1024) }));
    } else {
      const stream = mode === 'stderr' ? process.stderr : process.stdout;
      for (let index = 0; index < 80; index++) stream.write('x'.repeat(65536));
    }
  `);
  const { runBuretteAgent } = await import(pathToFileURL(join(root, 'mcp/lib/cli-bridge.mjs')));
  const valid = await runBuretteAgent(['valid']);
  assert.equal(valid.ok, true);
  assert.ok(valid.payload.result === 'ю'.repeat(1024 * 1024), 'large UTF-8 JSON must survive chunk boundaries');
  for (const stream of ['stdout', 'stderr']) {
    const limited = await runBuretteAgent([stream]);
    assert.equal(limited.ok, false);
    assert.equal(limited.error.code, 'CLI_OUTPUT_LIMIT');
    assert.equal(limited.stdout, '');
    assert.equal(limited.stderr, '');
  }
  console.log('burette agent CLI bridge output bounds tests passed');
} finally {
  await rm(root, { recursive: true, force: true });
}
