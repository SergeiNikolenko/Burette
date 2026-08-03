import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(repoRoot, 'node_modules', 'smiles-drawer');
const outputDir = path.join(repoRoot, 'PreviewExtension', 'Web', 'smiles-drawer');
const requiredFiles = [
  ['dist/smiles-drawer.min.js', 'smiles-drawer.min.js'],
  ['LICENSE.md', 'LICENSE.md'],
];

fs.mkdirSync(outputDir, { recursive: true });

for (const [sourceName, outputName] of requiredFiles) {
  const source = path.join(sourceDir, sourceName);
  if (!fs.existsSync(source)) {
    console.error(`error: cannot find ${sourceName} in smiles-drawer.`);
    console.error('Run: bun install --frozen-lockfile --ignore-scripts');
    process.exit(1);
  }
  const destination = path.join(outputDir, outputName);
  fs.copyFileSync(source, destination);
  console.log(`copied ${path.relative(repoRoot, destination)}`);
}

const lockResult = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'check-vendor-assets.mjs'), '--write'], {
  stdio: 'inherit',
});
if (lockResult.status !== 0) {
  process.exit(lockResult.status ?? 1);
}
