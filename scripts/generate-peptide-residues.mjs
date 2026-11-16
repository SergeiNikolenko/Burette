// Mechanical extraction from pinned BSD-3-Clause OpenChemistry sources.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), check = args.includes('--check'), local = args.indexOf('--source-dir');
const sourceDir = local < 0 ? null : args[local + 1];
if (local >= 0 && !sourceDir) throw new Error('--source-dir requires a directory.');
if (args.some((value, index) => value !== '--check' && value !== '--source-dir' && !(local >= 0 && index === local + 1))) throw new Error('Use --check and/or --source-dir <directory>.');
const config = JSON.parse(await readFile(resolve(root, 'config/peptide-residue-sources.json'), 'utf8'));
const sources = new Map();
for (const source of config.sources) {
  const key = `${source.repository.split('/')[1]}/${source.path}`;
  let bytes;
  if (sourceDir) bytes = await readFile(resolve(sourceDir, key));
  else {
    const response = await fetch(`https://raw.githubusercontent.com/${source.repository}/${source.commit}/${source.path}`, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Cannot read ${key}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (bytes.length !== source.bytes || createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw new Error(`Source identity mismatch: ${key}`);
  sources.set(key, bytes.toString('utf8'));
}
const header = sources.get('avogadrolibs/avogadro/core/residuedata.h'), data = {};
for (const [code, name] of Object.entries(config.residues)) {
  const atoms = sources.get(`fragments/amino/${name}.zmat`).trim().split(/\r?\n/).map(line => {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 8 || fields.slice(2).some(value => !Number.isFinite(Number(value)))) throw new Error(`Invalid atom row in ${name}`);
    return [...fields.slice(0, 2), ...fields.slice(2).map(Number)];
  });
  const block = header.match(new RegExp(`ResidueData ${name}Data\\([\\s\\S]*?\\);`))?.[0];
  if (!block) throw new Error(`Missing residue dictionary: ${name}`);
  const [single, double] = block.split('// Single Bonds')[1].split('// Double Bonds');
  const bonds = [single, double].flatMap((text, index) => [...text.matchAll(/\{\s*"([^"]+)",\s*"([^"]+)"\s*\}/g)].map(match => [match[1], match[2], index + 1]));
  data[code] = { name, atoms, bonds };
}
const generated = '{\n' + Object.entries(data).map(([code, residue]) => `${JSON.stringify(code)}: ${JSON.stringify(residue)}`).join(',\n') + '\n}\n';
const outputs = new Map([
  ['apps/desktop/src/lib/molecular-workbench/peptide-residues.json', generated],
  ['docs/third-party/fragments-LICENSE', sources.get('fragments/LICENSE')],
  ['apps/desktop/public/third-party-licenses/fragments-LICENSE', sources.get('fragments/LICENSE')],
]);
for (const [path, text] of outputs) {
  if (check) { if (await readFile(resolve(root, path), 'utf8') !== text) throw new Error(`Generated file differs: ${path}`); }
  else await writeFile(resolve(root, path), text);
}
console.log(`${check ? 'Checked' : 'Generated'} ${Object.keys(data).length} peptide templates and source notices.`);
