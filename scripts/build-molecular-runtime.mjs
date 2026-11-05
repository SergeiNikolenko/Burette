#!/usr/bin/env bun
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = resolve(root, 'plugins/burette-agent');
const scripts = resolve(plugin, 'scripts');
const require = createRequire(resolve(plugin, 'package.json'));
const dependencyIndex = process.argv.indexOf('--playwright-root');
if (dependencyIndex >= 0 && !process.argv[dependencyIndex + 1]) throw new Error('--playwright-root requires a package directory.');
const playwright = dependencyIndex >= 0 ? resolve(process.argv[dependencyIndex + 1])
  : dirname(require.resolve('playwright-core/package.json'));
const manifest = JSON.parse(await readFile(resolve(plugin, 'package.json'), 'utf8'));
const dependency = JSON.parse(await readFile(resolve(playwright, 'package.json'), 'utf8'));
if (dependency.name !== 'playwright-core' || dependency.version !== manifest.dependencies['playwright-core']) {
  throw new Error(`Expected playwright-core ${manifest.dependencies['playwright-core']}; received ${dependency.name} ${dependency.version}.`);
}

await mkdir(scripts, { recursive: true });
for (const name of ['molecular-jobs', 'molecular-worker', 'molecular-render', 'molecular-scene', 'molecular-session-actions']) {
  await cp(resolve(root, `scripts/${name}.mjs`), resolve(scripts, `${name}.mjs`));
}
// The numeric worker needs Mol* parsers and TM-align, but no installed modules.
const built = await Bun.build({ entrypoints: [resolve(root, 'scripts/molecular-analysis.mjs')],
  target: 'node', format: 'esm', minify: true, outdir: scripts, naming: 'molecular-analysis.mjs' });
if (!built.success) throw new Error(built.logs.join('\n'));

// Playwright loads driver resources relative to its package, so keep the exact
// npm package intact. Browser binaries are discovered separately at runtime.
const vendor = resolve(plugin, 'vendor/playwright-core');
await rm(vendor, { recursive: true, force: true });
await mkdir(dirname(vendor), { recursive: true });
await cp(playwright, vendor, { recursive: true, dereference: true });
console.log(`Built autonomous molecular runtime with playwright-core ${dependency.version}.`);
