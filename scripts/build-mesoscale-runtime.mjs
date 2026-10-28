#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { compileAsync } from 'sass';
import { molstarBuildPlugins } from './molstar-build-plugins.mjs';
import { prepareMolstarSource, molstarSourceRoot, resolveMolstarModule } from './molstar-source.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = resolve(root, 'PreviewExtension/Web');
const mirror = resolve(root, 'plugins/burette-agent/preview-web');
await prepareMolstarSource();
await mkdir(web, { recursive: true });
const result = await Bun.build({
  entrypoints: [resolve(root, 'apps/desktop/src/preview-mesoscale/mesoscale-runtime.ts')],
  target: 'browser', format: 'iife', minify: true, write: false,
  loader: { '.jpg': 'dataurl', '.png': 'dataurl', '.svg': 'dataurl' },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') }, plugins: molstarBuildPlugins,
});
if (!result.success) throw new AggregateError(result.logs, 'Could not build the Mesoscale runtime.');
const output = result.outputs.find(item => item.kind === 'entry-point');
if (!output) throw new Error('No Mesoscale bundle generated.');
const styles = await compileAsync(resolve(molstarSourceRoot, 'apps/mesoscale-explorer/src/style.scss'), {
  style: 'compressed', silenceDeprecations: ['import', 'global-builtin', 'color-functions'],
  importers: [{ findFileUrl: url => url.startsWith('pkg:') ? pathToFileURL(resolveMolstarModule(url.slice(4))) : null }],
});
const theme = await readFile(resolve(root, 'apps/desktop/src/preview-mesoscale/mesoscale-burette-theme.css'), 'utf8');
const assets = { 'mesoscale.js': await output.text(), 'mesoscale.css': `${styles.css}\n${theme.trimEnd()}\n` };
await mkdir(mirror, { recursive: true });
for (const [name, contents] of Object.entries(assets)) {
  await writeFile(resolve(web, name), contents);
  await writeFile(resolve(mirror, name), contents);
}
console.log('Built pinned Mol* Mesoscale runtime and styles.');
const lock = spawnSync(process.execPath, [resolve(root, 'scripts/check-vendor-assets.mjs'), '--write'], { stdio: 'inherit' });
if (lock.status !== 0) process.exit(lock.status ?? 1);
