import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceCandidates = [
  path.join(repoRoot, 'node_modules', '@rdkit', 'rdkit', 'dist'),
  path.join(repoRoot, 'node_modules', '@rdkit', 'rdkit')
];
const outputDir = path.join(repoRoot, 'PreviewExtension', 'Web', 'rdkit');
const requiredFiles = ['RDKit_minimal.js', 'RDKit_minimal.wasm'];

function findSourceFile(fileName) {
  for (const dir of sourceCandidates) {
    const direct = path.join(dir, fileName);
    if (fs.existsSync(direct)) return direct;
  }
  return null;
}

fs.mkdirSync(outputDir, { recursive: true });

for (const fileName of requiredFiles) {
  const source = findSourceFile(fileName);
  if (!source) {
    console.error(`error: cannot find ${fileName} in @rdkit/rdkit.`);
    console.error('Run: npm install --ignore-scripts');
    process.exit(1);
  }
  const destination = path.join(outputDir, fileName);
  fs.copyFileSync(source, destination);
  console.log(`copied ${path.relative(repoRoot, destination)}`);
}

for (const licenseName of ['LICENSE', 'LICENSE.md', 'README.md']) {
  const source = sourceCandidates
    .map(dir => path.join(dir, licenseName))
    .find(candidate => fs.existsSync(candidate));
  if (source) {
    fs.copyFileSync(source, path.join(outputDir, licenseName));
    break;
  }
}
