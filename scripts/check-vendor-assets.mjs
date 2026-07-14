#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBunPackageSnapshot, readBunLock } from './bun-lock.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = path.join(repoRoot, 'vendor-assets.lock.json');
const profilesPath = path.join(repoRoot, 'config', 'web-runtime-profiles.json');
const bunLockPath = path.join(repoRoot, 'bun.lock');
const writeLock = process.argv.includes('--write');
const requestedProfiles = process.argv
  .flatMap((arg, index, args) => {
    if (arg === '--profile') return [args[index + 1]].filter(Boolean);
    if (arg.startsWith('--profile=')) return [arg.slice('--profile='.length)];
    return [];
  });

const packageSpecs = [
  { name: 'molstar' },
  { name: '@rdkit/rdkit' },
  { name: 'openchemlib' },
];

const assetSpecs = [
  { path: 'PreviewExtension/Web/molstar.js', package: 'molstar' },
  { path: 'PreviewExtension/Web/molstar.css', package: 'molstar' },
  { path: 'PreviewExtension/Web/rdkit/RDKit_minimal.js', package: '@rdkit/rdkit' },
  { path: 'PreviewExtension/Web/rdkit/RDKit_minimal.wasm', package: '@rdkit/rdkit' },
  { path: 'PreviewExtension/Web/openchemlib/openchemlib.js', package: 'openchemlib' },
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
  const profiles = readRuntimeProfiles();
  return {
    schemaVersion: 2,
    source: {
      bunLock: 'bun.lock',
      profiles: 'config/web-runtime-profiles.json',
    },
    packages: Object.fromEntries(
      packageSpecs.map(spec => [spec.name, packageSnapshot(bunLock, spec)]),
    ),
    assets: assetSpecs.map(assetSnapshot),
    profiles: profiles.profiles,
    bundleTargets: profiles.bundleTargets,
  };
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const snapshot = currentSnapshot();
validateRuntimeProfiles(snapshot);

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

function readRuntimeProfiles() {
  if (!fs.existsSync(profilesPath)) {
    throw new Error('config/web-runtime-profiles.json is missing.');
  }
  const profiles = readJson(profilesPath);
  if (profiles.schemaVersion !== 1) {
    throw new Error('Unsupported web runtime profile schemaVersion.');
  }
  if (profiles.sourceRoot !== 'PreviewExtension/Web') {
    throw new Error('Web runtime profiles must use PreviewExtension/Web as sourceRoot.');
  }
  return profiles;
}

function validateRuntimeProfiles(snapshot) {
  const profiles = snapshot.profiles || {};
  const profileNames = requestedProfiles.length ? requestedProfiles : Object.keys(profiles);
  const sourceRoot = path.join(repoRoot, 'PreviewExtension', 'Web');
  const seenNames = new Set();
  for (const profileName of profileNames) {
    if (!profiles[profileName]) {
      throw new Error(`Unknown web runtime profile: ${profileName}`);
    }
    if (seenNames.has(profileName)) continue;
    seenNames.add(profileName);
    const files = profiles[profileName];
    if (!Array.isArray(files) || files.length === 0) {
      throw new Error(`Web runtime profile ${profileName} is empty.`);
    }
    for (const relativePath of files) {
      if (typeof relativePath !== 'string' || !relativePath || relativePath.startsWith('/') || relativePath.includes('..')) {
        throw new Error(`Invalid path in web runtime profile ${profileName}: ${relativePath}`);
      }
      const absolutePath = path.join(sourceRoot, relativePath);
      if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
        throw new Error(`Missing web runtime profile asset: ${profileName}:${relativePath}`);
      }
    }
  }

  const allProfileFiles = new Set(Object.values(profiles).flat());
  for (const asset of snapshot.assets) {
    const relativePath = asset.path.replace(/^PreviewExtension\/Web\//, '');
    if (!allProfileFiles.has(relativePath)) {
      throw new Error(`Vendored asset is not covered by a web runtime profile: ${asset.path}`);
    }
  }
  validateBundleCoverage(snapshot);
}

function validateBundleCoverage(snapshot) {
  const tauriConfig = readJson(path.join(repoRoot, 'apps', 'desktop', 'src-tauri', 'tauri.conf.json'));
  const resources = tauriConfig?.bundle?.resources || {};
  if (resources['../../../PreviewExtension/Web'] !== 'ViewerWeb') {
    throw new Error('Tauri resources must include PreviewExtension/Web as ViewerWeb for desktop runtime profiles.');
  }
  const pbxproj = fs.readFileSync(path.join(repoRoot, 'Burrete.xcodeproj', 'project.pbxproj'), 'utf8');
  if (!pbxproj.includes('path = Web;') || !pbxproj.includes('Web in Resources')) {
    throw new Error('Quick Look Xcode resources must include PreviewExtension/Web for Quick Look profiles.');
  }
  const targets = snapshot.bundleTargets || {};
  for (const [targetName, target] of Object.entries(targets)) {
    for (const profileName of target.profiles || []) {
      if (!snapshot.profiles[profileName]) {
        throw new Error(`Bundle target ${targetName} references unknown profile ${profileName}.`);
      }
    }
  }
}
