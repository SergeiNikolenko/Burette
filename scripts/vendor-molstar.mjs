#!/usr/bin/env bun
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { molstarSourcePlugin, prepareMolstarSource, molstarSourceRoot } from './molstar-source.mjs';
import { molstarBuildPlugins } from './molstar-build-plugins.mjs';
import { compileAsync } from 'sass';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webDir = join(projectRoot, 'PreviewExtension/Web');
await prepareMolstarSource();
mkdirSync(webDir, { recursive: true });
const plugins = molstarBuildPlugins;
await bundle('scripts/molstar-viewer-entry.js', join(webDir, 'molstar.js'), 'browser', plugins);
await bundle('scripts/mvs-schema-validator-entry.mjs', join(projectRoot, 'scripts/mvs-schema-validator.mjs'), 'node', [molstarSourcePlugin]);
const styles = await compileAsync(join(molstarSourceRoot, 'packages/plugin/ui/src/skin/light.scss'), { style: 'compressed', silenceDeprecations: ['import', 'global-builtin', 'color-functions'] });
await Bun.write(join(webDir, 'molstar.css'), styles.css);
console.log('Built pinned Mol* viewer, styles and Node authoring schema.');
const lockResult = spawnSync(process.execPath, [join(projectRoot, 'scripts/check-vendor-assets.mjs'), '--write'], { stdio: 'inherit' });
if (lockResult.status !== 0) process.exit(lockResult.status ?? 1);

async function bundle(entry, destination, target, bundlePlugins) {
  const result = await Bun.build({
    entrypoints: [join(projectRoot, entry)], target, format: target === 'browser' ? 'iife' : 'esm', minify: true,
    write: false, loader: { '.jpg': 'dataurl', '.png': 'dataurl', '.svg': 'dataurl' },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') }, plugins: bundlePlugins,
  });
  if (!result.success) throw new AggregateError(result.logs, `Could not build ${entry}`);
  const output = result.outputs.find(item => item.kind === 'entry-point');
  if (!output) throw new Error(`No bundle generated for ${entry}`);
  await Bun.write(destination, (await output.text()).replace(/[ \t]+$/gmu, ''));
}
