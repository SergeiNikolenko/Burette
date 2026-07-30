#!/usr/bin/env node
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');
const webDir = join(projectRoot, 'PreviewExtension', 'Web');

const require = createRequire(import.meta.url);
let molstarPkg;
try {
  molstarPkg = require.resolve('molstar/package.json');
} catch (error) {
  console.error('\nMol* is not installed yet. Run:\n\n  bun install --frozen-lockfile --ignore-scripts\n  bun run vendor:molstar\n');
  process.exit(1);
}

const molstarRoot = dirname(molstarPkg);
const viewerDir = join(molstarRoot, 'build', 'viewer');
const viewerEntry = join(projectRoot, 'scripts', 'molstar-viewer-entry.js');

if (!existsSync(viewerDir) || !statSync(viewerDir).isDirectory()) {
  console.error(`Expected Mol* viewer build directory not found: ${viewerDir}`);
  console.error('The Mol* package layout may have changed. Check node_modules/molstar/build/viewer.');
  process.exit(1);
}

mkdirSync(webDir, { recursive: true });
if (typeof Bun?.build !== 'function') {
  console.error('Mol* vendoring requires Bun.build. Run: bun scripts/vendor-molstar.mjs');
  process.exit(1);
}
const buildResult = await Bun.build({
  entrypoints: [viewerEntry],
  target: 'browser',
  format: 'iife',
  naming: 'molstar.js',
  minify: true,
  write: false,
  loader: { '.jpg': 'dataurl' },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
});
if (!buildResult.success) {
  for (const log of buildResult.logs) console.error(log);
  process.exit(1);
}
const jsOutput = buildResult.outputs.find(output => output.kind === 'entry-point');
if (!jsOutput) {
  console.error('Bun.build did not produce the Mol* JavaScript entry point.');
  process.exit(1);
}
const jsTarget = join(webDir, 'molstar.js');
await Bun.write(jsTarget, jsOutput);
console.log(`Built Mol* viewer with Burette superposition facade -> ${jsTarget}`);

const cssSource = join(viewerDir, 'molstar.css');
const cssTarget = join(webDir, 'molstar.css');
if (!existsSync(cssSource)) {
  console.error(`Missing Mol* asset: ${cssSource}`);
  process.exit(1);
}
copyFileSync(cssSource, cssTarget);
console.log(`Vendored molstar.css -> ${cssTarget}`);

const lockResult = spawnSync(process.execPath, [join(projectRoot, 'scripts', 'check-vendor-assets.mjs'), '--write'], {
  stdio: 'inherit',
});
if (lockResult.status !== 0) {
  process.exit(lockResult.status ?? 1);
}
