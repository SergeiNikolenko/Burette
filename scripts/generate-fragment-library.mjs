// Mechanical extraction of the pinned BSD-3-Clause OpenChemistry/fragments
// functional groups into the insertion library. Each group keeps its source
// coordinates, Kekule bond orders, formal charges and its one dummy attachment atom.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), check = args.includes('--check'), local = args.indexOf('--source-dir');
const sourceDir = local < 0 ? null : args[local + 1];
if (local >= 0 && !sourceDir) throw new Error('--source-dir requires a directory.');
if (args.some((value, index) => value !== '--check' && value !== '--source-dir' && !(local >= 0 && index === local + 1))) throw new Error('Use --check and/or --source-dir <directory>.');
const config = JSON.parse(await readFile(resolve(root, 'config/fragment-library-sources.json'), 'utf8'));
const sources = new Map();
for (const source of config.files) {
  let bytes;
  if (sourceDir) bytes = await readFile(resolve(sourceDir, source.path));
  else {
    const response = await fetch(`https://raw.githubusercontent.com/${config.repository}/${config.commit}/${source.path}`, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Cannot read ${source.path}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (bytes.length !== source.bytes || createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw new Error(`Source identity mismatch: ${source.path}`);
  sources.set(source.path, bytes.toString('utf8'));
}
const fragments = [];
for (const [path, text] of sources) {
  const match = /^groups\/([a-z_]+)\/(.+)\.cjson$/u.exec(path);
  if (!match) continue;
  const data = JSON.parse(text), elements = data.atoms.elements.number, coords = data.atoms.coords['3d'];
  const index = data.bonds.connections.index, order = data.bonds.order, charges = data.atoms.formalCharges ?? elements.map(() => 0);
  if (!elements.length || coords.length !== 3 * elements.length || index.length !== 2 * order.length || charges.length !== elements.length
    || !coords.every(Number.isFinite) || elements.some(z => !Number.isInteger(z) || z < 0 || z > 118)) throw new Error(`Invalid group record: ${path}`);
  const dummy = elements.indexOf(0), dummyBonds = order.filter((_, bond) => index[2 * bond] === dummy || index[2 * bond + 1] === dummy);
  if (elements.lastIndexOf(0) !== dummy || dummyBonds.length !== 1 || dummyBonds[0] !== 1) throw new Error(`A group needs one singly bonded dummy atom: ${path}`);
  if (order.some(value => ![1, 2, 3].includes(value)) || index.some(atom => !Number.isInteger(atom) || atom < 0 || atom >= elements.length)) throw new Error(`Invalid group bonds: ${path}`);
  const bonds = order.flatMap((value, bond) => [index[2 * bond], index[2 * bond + 1], value]);
  fragments.push({ id: `${match[1]}/${match[2]}`, category: match[1].replace(/_/gu, ' '), name: match[2].replace(/_/gu, ' '), elements, coords, bonds, ...(charges.some(Boolean) ? { charges } : {}) });
}
const generated = `{\n"source": ${JSON.stringify({ repository: config.repository, commit: config.commit, license: config.license })},\n"fragments": [\n${fragments.map(fragment => JSON.stringify(fragment)).join(',\n')}\n]\n}\n`;
const outputs = new Map([
  ['apps/desktop/src/lib/molecular-workbench/fragment-library.json', generated],
  ['docs/third-party/fragments-LICENSE', sources.get('LICENSE')],
  ['apps/desktop/public/third-party-licenses/fragments-LICENSE', sources.get('LICENSE')],
]);
for (const [path, text] of outputs) {
  if (check) { if (await readFile(resolve(root, path), 'utf8') !== text) throw new Error(`Generated file differs: ${path}`); }
  else await writeFile(resolve(root, path), text);
}
console.log(`${check ? 'Checked' : 'Generated'} ${fragments.length} insertion fragments and source notices.`);
