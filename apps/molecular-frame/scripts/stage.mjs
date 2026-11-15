import { createHash } from 'node:crypto';
import { cp, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';

const source = fileURLToPath(new URL('../dist/', import.meta.url));
const destination = fileURLToPath(new URL('../../desktop/public/molecular-frame/', import.meta.url));
const manifest = JSON.parse(await readFile(resolve(source, 'manifest.json'), 'utf8'));
if (manifest.name !== 'burette-molecular-frame' || !manifest.files['molecular-frame.js'] || !manifest.files['index.html']) {
  throw new Error('Build the molecular frame before staging it.');
}
for (const [name, digest] of Object.entries(manifest.files)) {
  const path = resolve(source, name);
  if (!path.startsWith(resolve(source) + sep)) throw new Error('Invalid molecular frame asset path.');
  const actual = createHash('sha256').update(await readFile(path)).digest('hex');
  if (actual !== digest) throw new Error(`Molecular frame asset differs from its manifest: ${name}`);
}
await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });
console.log(`Staged molecular frame ${manifest.version} for desktop and plugin builds.`);
