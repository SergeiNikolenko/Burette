import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const run = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));

test('packaged molecular worker and driver run outside the checkout without node_modules', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'burette-molecular-package-'));
  try {
    for (const folder of ['scripts', 'vendor']) {
      await cp(resolve(root, 'plugins/burette-agent', folder), join(directory, folder), { recursive: true });
    }
    await cp(resolve(root, 'samples/mini.pdb'), join(directory, 'input.pdb'));
    const program = `
      import { randomUUID } from 'node:crypto';
      import { mkdir } from 'node:fs/promises';
      import { createRequire } from 'node:module';
      import { runMolecularJob } from './scripts/molecular-jobs.mjs';
      const require = createRequire(import.meta.url);
      const driver = require('./vendor/playwright-core');
      await mkdir('./session');
      const job = await runMolecularJob({ sessionDir: './session', runtimeRoot: './runtime',
        sessionId: randomUUID(), requestId: randomUUID(), waitMs: 30000,
        documents: [{id: randomUUID(), path: process.cwd() + '/input.pdb', format: 'pdb'}], action: {type: 'inspect'} });
      console.log(JSON.stringify({ job, chromium: driver.chromium.name() }));
    `;
    const output = await run(process.execPath, ['--input-type=module', '-e', program], {
      cwd: directory, timeout: 35000, maxBuffer: 65536,
    });
    const { job, chromium } = JSON.parse(output.stdout);
    assert.equal(job.status, 'completed', JSON.stringify(job.error));
    assert.ok(job.result.inventory[0].atomCount > 0);
    assert.equal(chromium, 'chromium');
    const lock = JSON.parse(await readFile(resolve(root, 'plugins/burette-agent/package-lock.json'), 'utf8'));
    const vendored = JSON.parse(await readFile(join(directory, 'vendor/playwright-core/package.json'), 'utf8'));
    assert.equal(vendored.version, lock.packages['node_modules/playwright-core'].version);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
