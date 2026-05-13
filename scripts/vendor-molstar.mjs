#!/usr/bin/env node
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');
const webDir = join(projectRoot, 'PreviewExtension', 'Web');
const dependencyRoots = [
  join(projectRoot, 'apps', 'desktop'),
  projectRoot
];

const require = createRequire(import.meta.url);
let molstarPkg = null;
for (const dependencyRoot of dependencyRoots) {
  try {
    molstarPkg = require.resolve('molstar/package.json', { paths: [dependencyRoot] });
    break;
  } catch (error) {
    // Try the next workspace location.
  }
}

if (!molstarPkg) {
  console.error('\nMol* is not installed yet. Run:\n\n  pnpm install --ignore-scripts\n  pnpm run vendor:molstar\n');
  process.exit(1);
}

const molstarRoot = dirname(molstarPkg);
const viewerDir = join(molstarRoot, 'build', 'viewer');
const files = ['molstar.js', 'molstar.css'];

if (!existsSync(viewerDir) || !statSync(viewerDir).isDirectory()) {
  console.error(`Expected Mol* viewer build directory not found: ${viewerDir}`);
  console.error('The Mol* package layout may have changed. Reinstall deps and rerun:\n  pnpm install --ignore-scripts\n  pnpm run vendor:molstar');
  process.exit(1);
}

mkdirSync(webDir, { recursive: true });
for (const file of files) {
  const source = join(viewerDir, file);
  const target = join(webDir, file);
  if (!existsSync(source)) {
    console.error(`Missing Mol* asset: ${source}`);
    process.exit(1);
  }
  copyFileSync(source, target);
  console.log(`Vendored ${file} -> ${target}`);
}
