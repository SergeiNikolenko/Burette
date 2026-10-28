#!/usr/bin/env node
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const outputDir = path.join(repoRoot, 'PreviewExtension', 'Web', 'openchemlib');
const output = path.join(outputDir, 'openchemlib.js');

await mkdir(outputDir, { recursive: true });
const result = await Bun.build({
  entrypoints: [path.join(repoRoot, 'scripts', 'openchemlib-global.ts')],
  outdir: outputDir,
  naming: 'openchemlib.js',
  format: 'iife',
  minify: true,
  target: 'browser',
  define: {
    'import.meta.dirname': '""',
    'import.meta.filename': '""',
    'import.meta.url': '""',
  },
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
await copyFile(path.join(repoRoot, 'node_modules/openchemlib/LICENSE'), path.join(outputDir, 'LICENSE'));
console.log(`Vendored ${path.relative(repoRoot, output)} as an OpenChemLib browser global.`);
