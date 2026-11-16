import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const files = {};
async function visit(directory = '') {
  for (const item of await readdir(root + directory, { withFileTypes: true })) {
    const name = directory + item.name;
    if (item.isDirectory()) await visit(name + '/');
    else if (name !== 'manifest.json') files[name] = createHash('sha256').update(await readFile(root + name)).digest('hex');
  }
}
await visit();
const ordered = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
const version = createHash('sha256').update(JSON.stringify(ordered)).digest('hex').slice(0, 12);
await writeFile(root + 'manifest.json', JSON.stringify({ name: 'burette-molecular-frame', version, files: ordered }, null, 2) + '\n');
console.log(`Molecular frame ${version}, ${Object.keys(files).length} assets`);
