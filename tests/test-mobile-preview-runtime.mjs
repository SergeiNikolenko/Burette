#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'darwin') {
  console.log('SKIP mobile preview runtime: requires macOS SwiftUI SDK (covered by macOS CI).');
  process.exit(0);
}

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = mkdtempSync(path.join(tmpdir(), 'burette-mobile-tests-'));
const binary = path.join(directory, 'runtime-tests');
try {
  const compile = spawnSync('xcrun', ['swiftc',
    'ios/BuretteMobile/MobilePreviewRuntime.swift',
    'ios/BuretteMobile/MobileAppModel.swift',
    'tests/mobile-preview-runtime-tests.swift', '-o', binary,
  ], { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
  assert.equal(compile.status, 0, compile.error?.message || compile.stderr);
  const run = spawnSync(binary, [], { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
  assert.equal(run.status, 0, run.error?.message || run.stderr);
  console.log(run.stdout.trim() || 'mobile preview runtime tests passed');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
