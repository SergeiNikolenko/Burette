#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBunPackageSnapshot, readBunLock } from './bun-lock.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = path.join(repoRoot, 'vendor-assets.lock.json');
const bunLockPath = path.join(repoRoot, 'bun.lock');
const writeLock = process.argv.includes('--write');

const packageSpecs = [
  { name: 'molstar' },
  { name: '@rdkit/rdkit' },
];

const assetSpecs = [
  { path: 'PreviewExtension/Web/molstar.js', package: 'molstar' },
  { path: 'PreviewExtension/Web/molstar.css', package: 'molstar' },
  { path: 'PreviewExtension/Web/rdkit/RDKit_minimal.js', package: '@rdkit/rdkit' },
  { path: 'PreviewExtension/Web/rdkit/RDKit_minimal.wasm', package: '@rdkit/rdkit' },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function packageSnapshot(bunLock, spec) {
  const entry = getBunPackageSnapshot(bunLock, spec.name);
  return {
    packageName: spec.name,
    version: entry.version,
    integrity: entry.integrity,
  };
}

function assetSnapshot(spec) {
  const absolutePath = path.join(repoRoot, spec.path);
  const bytes = fs.readFileSync(absolutePath);
  return {
    path: spec.path,
    package: spec.package,
    bytes: bytes.length,
    sha256: `sha256-${crypto.createHash('sha256').update(bytes).digest('base64')}`,
  };
}

function currentSnapshot() {
  const bunLock = readBunLock(bunLockPath);
  return {
    schemaVersion: 1,
    source: {
      bunLock: 'bun.lock',
    },
    packages: Object.fromEntries(
      packageSpecs.map(spec => [spec.name, packageSnapshot(bunLock, spec)]),
    ),
    assets: assetSpecs.map(assetSnapshot),
  };
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const snapshot = currentSnapshot();

if (writeLock) {
  fs.writeFileSync(lockPath, stableJson(snapshot));
  console.log(`Updated ${path.relative(repoRoot, lockPath)}`);
  process.exit(0);
}

if (!fs.existsSync(lockPath)) {
  console.error('vendor-assets.lock.json is missing. Run: bun run vendor:lock');
  process.exit(1);
}

const expected = stableJson(readJson(lockPath));
const actual = stableJson(snapshot);
if (expected !== actual) {
  console.error('Vendored asset lock is stale. Run: bun run vendor:lock');
  process.exit(1);
}

console.log('Vendored asset lock is current.');
