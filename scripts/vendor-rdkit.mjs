import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Viewer chemistry follows the current release. cluster.v1 keeps its reviewed
// scientific baseline as a distinct, integrity-checked engine.
for (const [packageName, directory] of [['@rdkit/rdkit', 'rdkit'], ['rdkit-compute', 'rdkit-compute']]) {
  const packageRoot = path.join(repoRoot, 'node_modules', packageName);
  const sourceCandidates = [path.join(packageRoot, 'dist'), packageRoot];
  const outputDir = path.join(repoRoot, 'PreviewExtension', 'Web', directory);
  fs.mkdirSync(outputDir, { recursive: true });
  for (const fileName of ['RDKit_minimal.js', 'RDKit_minimal.wasm']) {
    const source = sourceCandidates.map(dir => path.join(dir, fileName)).find(file => fs.existsSync(file));
    if (!source) throw new Error(`Cannot find ${fileName} in ${packageName}. Run vp install.`);
    const destination = path.join(outputDir, fileName);
    fs.copyFileSync(source, destination);
    if (directory === 'rdkit' && fileName.endsWith('.js')) {
      fs.appendFileSync(destination, '\n' + fs.readFileSync(path.join(repoRoot, 'scripts/rdkit-browser-loader.js'), 'utf8'));
    }
    console.log(`copied ${path.relative(repoRoot, destination)}`);
  }
  for (const licenseName of ['LICENSE', 'LICENSE.md', 'README.md']) {
    const source = sourceCandidates.map(dir => path.join(dir, licenseName)).find(file => fs.existsSync(file));
    if (source) { fs.copyFileSync(source, path.join(outputDir, licenseName)); break; }
  }
}

const lockResult = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'check-vendor-assets.mjs'), '--write'], {
  stdio: 'inherit',
});
if (lockResult.status !== 0) {
  process.exit(lockResult.status ?? 1);
}
