#!/usr/bin/env bun
// Lexical/numeric acceptance only: no symmetry expansion or scientific reference claim.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseCifText } from 'molstar/lib/mol-io/reader/cif/text/parser.js';

const lock = JSON.parse(readFileSync(new URL('../config/crystals-resource.lock.json', import.meta.url), 'utf8'));
const bundle = JSON.parse(gunzipSync(readFileSync(new URL(`../${lock.bundle.path}`, import.meta.url)), { maxOutputLength: lock.limits.retainedBytes * 2 }).toString());
function field(block, category, key) {
  return block.categories[category]?.getField(key) ?? block.categories[`${category}_${key}`]?.getField('');
}
function numeric(value) {
  if (!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?(?:\(\d+\))?$/u.test(value)) throw new Error('Missing or invalid numeric value');
  const number = Number(value.replace(/\(\d+\)$/u, ''));
  if (!Number.isFinite(number)) throw new Error('Non-finite numeric value');
  return number;
}
let parsedFiles = 0, numericFiles = 0, atomSites = 0;
const errors = [];
for (const file of bundle.files.filter(file => file.path.endsWith('.cif'))) {
  try {
    const parsed = await parseCifText(Buffer.from(file.dataBase64, 'base64').toString('utf8')).run();
    if (parsed.isError) throw new Error(`CIF parse: ${parsed.message}`);
    parsedFiles++;
    let blocks = 0;
    for (const block of parsed.result.blocks) {
      const coordinates = ['x', 'y', 'z'].map(axis => field(block, 'atom_site', `fract_${axis}`));
      if (!coordinates.every(Boolean)) throw new Error('Missing fractional atom coordinates');
      const lengths = ['a', 'b', 'c'].map(axis => numeric(field(block, 'cell', `length_${axis}`)?.str(0)));
      const angles = ['alpha', 'beta', 'gamma'].map(axis => numeric(field(block, 'cell', `angle_${axis}`)?.str(0)));
      if (lengths.some(value => value <= 0) || angles.some(value => value <= 0 || value >= 180)) throw new Error('Invalid cell lengths/angles');
      const [alpha, beta, gamma] = angles.map(value => Math.cos(value * Math.PI / 180));
      if (1 + 2 * alpha * beta * gamma - alpha * alpha - beta * beta - gamma * gamma <= 1e-10) throw new Error('Degenerate unit-cell metric');
      const rows = coordinates[0].rowCount;
      if (!rows || coordinates.some(column => column.rowCount !== rows)) throw new Error('Inconsistent atom-coordinate rows');
      for (let row = 0; row < rows; row++) for (const column of coordinates) numeric(column.str(row));
      atomSites += rows;
      blocks++;
    }
    if (!blocks) throw new Error('No crystal data blocks');
    numericFiles++;
  } catch (error) { errors.push({ path: file.path, error: error.message.slice(0, 200) }); }
}
console.log(JSON.stringify({ scope: 'CIF lexical parse, finite fractional coordinates and positive cell metric only', parsedFiles, numericFiles, atomSites, failureCount: errors.length, failures: errors.slice(0, 16) }, null, 2));
if (numericFiles !== lock.corpus.cifCount || errors.length) process.exitCode = 1;
