import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createXyzrenderWorker } from '../apps/desktop/vite/browser-dev/xyzrender-worker.ts';

const executable = process.env.XYZRENDER_EXECUTABLE;
assert.ok(executable, 'Set XYZRENDER_EXECUTABLE to the installed xyzrender CLI');
const directory = await mkdtemp(join(tmpdir(), 'xyzrender-worker-test-'));
const worker = createXyzrenderWorker();
const input = resolve('apps/burette-public-plugin/public/demo-library/Quantum/caffeine.xyz');
async function render(name, flags = []) {
  const output = join(directory, `${name}.svg`);
  await worker.run(executable, [input, '-o', output, ...flags], new AbortController().signal);
  return await readFile(output, 'utf8');
}
try {
  const [normal, hidden, transparent] = await Promise.all([
    render('normal'), render('hidden', ['--no-bonds']), render('transparent', ['--transparent']),
  ]);
  assert.match(normal, /<line /);
  assert.doesNotMatch(hidden, /<line /);
  assert.match(normal, /<rect[^>]+fill="#ffffff"/);
  assert.doesNotMatch(transparent, /<rect[^>]+fill="#ffffff"/);
  // A previous request's flags must not leak into the next invocation.
  assert.match(await render('vdw', ['--vdw']), /<polygon /);
  const restored = await render('restored');
  assert.match(restored, /<line /);
  assert.doesNotMatch(restored, /<polygon /);
  assert.match(restored, /<rect[^>]+fill="#ffffff"/);
  await assert.rejects(render('invalid', ['--not-a-real-option']));
  assert.match(await render('after-error'), /<svg/);
  worker.stop();
  assert.match(await render('restarted'), /<svg/);
  console.log('xyzrender worker: serialized renders, isolated flags, error recovery and restart passed');
} finally { worker.stop(); await rm(directory, { recursive: true, force: true }); }
