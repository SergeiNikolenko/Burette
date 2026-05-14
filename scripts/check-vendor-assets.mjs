#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = path.join(repoRoot, 'vendor-assets.lock.json');
const packageLockPath = path.join(repoRoot, 'package-lock.json');
const writeLock = process.argv.includes('--write');

const packageSpecs = [
  { name: 'molstar', packageLockPath: 'node_modules/molstar' },
  { name: '@rdkit/rdkit', packageLockPath: 'node_modules/@rdkit/rdkit' },
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

function packageSnapshot(packageLock, spec) {
  const entry = packageLock.packages?.[spec.packageLockPath];
  if (!entry) {
    throw new Error(`Missing ${spec.packageLockPath} in package-lock.json.`);
  }
  if (!entry.version || !entry.integrity) {
    throw new Error(`Missing version or integrity for ${spec.packageLockPath} in package-lock.json.`);
  }
  return {
    packageLockPath: spec.packageLockPath,
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
  const packageLock = readJson(packageLockPath);
  return {
    schemaVersion: 1,
    source: {
      packageLock: 'package-lock.json',
    },
    packages: Object.fromEntries(
      packageSpecs.map(spec => [spec.name, packageSnapshot(packageLock, spec)]),
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
  console.error('vendor-assets.lock.json is missing. Run: npm run vendor:lock');
  process.exit(1);
}

const expected = stableJson(readJson(lockPath));
const actual = stableJson(snapshot);
if (expected !== actual) {
  console.error('Vendored asset lock is stale. Run: npm run vendor:lock');
  process.exit(1);
}

console.log('Vendored asset lock is current.');
