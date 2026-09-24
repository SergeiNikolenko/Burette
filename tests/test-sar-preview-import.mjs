import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'darwin') {
  console.log('SKIP Swift SAR preview import: requires macOS.');
  process.exit(0);
}
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = mkdtempSync(join(tmpdir(), 'burette-sar-import-'));
try {
  const binary = join(directory, 'test');
  const compile = spawnSync('xcrun', ['swiftc',
    'PreviewExtension/MoleculeGridPreview.swift', 'tests/sar-preview-import-tests.swift', '-o', binary,
  ], { cwd: root, encoding: 'utf8', timeout: 60000 });
  assert.equal(compile.status, 0, compile.error?.message || compile.stderr);
  const run = spawnSync(binary, ['tests/fixtures/sar/two-series-saved.csv'], {
    cwd: root, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(run.status, 0, run.error?.message || run.stderr);
  console.log(run.stdout.trim());
} finally {
  rmSync(directory, { recursive: true, force: true });
}
