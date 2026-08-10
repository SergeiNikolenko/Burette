import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const preflight = path.join(root, 'scripts', 'check-metal-toolchain.sh');

function runWithFakeTools(xcrunBody, componentStatus = 'not installed') {
  const fakeBin = mkdtempSync(path.join(tmpdir(), 'burette-metal-toolchain-'));
  const fakeXcrun = path.join(fakeBin, 'xcrun');
  const fakeXcodebuild = path.join(fakeBin, 'xcodebuild');
  writeFileSync(fakeXcrun, `#!/usr/bin/env bash\n${xcrunBody}\n`);
  writeFileSync(
    fakeXcodebuild,
    `#!/usr/bin/env bash\necho "Status: ${componentStatus}"\n`,
  );
  chmodSync(fakeXcrun, 0o755);
  chmodSync(fakeXcodebuild, 0o755);
  try {
    return spawnSync('bash', [preflight], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ''}` },
    });
  } finally {
    rmSync(fakeBin, { force: true, recursive: true });
  }
}

{
  const result = runWithFakeTools(
    'echo "error: cannot execute tool metal due to missing Metal Toolchain" >&2; exit 1',
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /xcodebuild -downloadComponent MetalToolchain/);
}

{
  const result = runWithFakeTools('echo "Apple metal version 32023.850"; exit 0');

  assert.equal(result.status, 0);
}

{
  const result = runWithFakeTools(
    'echo "error: cannot execute tool metal due to missing Metal Toolchain" >&2; exit 1',
    'installed',
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /xcrun --kill-cache/);
}

{
  for (const relativePath of ['scripts/build.sh', 'scripts/build-dev.sh']) {
    const source = readFileSync(path.join(root, relativePath), 'utf8');
    const preflightIndex = source.indexOf('check-metal-toolchain.sh');
    const tauriIndex = source.indexOf('bun run build:tauri');
    assert.notEqual(preflightIndex, -1, `${relativePath} is missing the Metal preflight`);
    assert.ok(preflightIndex < tauriIndex, `${relativePath} runs the preflight too late`);
  }
}

console.log('Metal toolchain preflight contract passed.');
