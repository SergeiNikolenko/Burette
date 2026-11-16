#!/usr/bin/env node
// Cuts a Gaussian scan or IRC log down to what the reaction-path tests read: whole lines of the
// original, in order. Everything before the first geometry is kept; after it only the geometry
// tables, the energies, the scan and IRC step markers, the IRC point blocks and the summaries.
// Usage: node excerpt.mjs <gaussian log> > <excerpt>
import { readFileSync } from 'node:fs';

const lines = readFileSync(process.argv[2], 'utf8').split('\n');
const keep = new Array(lines.length).fill(false);
const dashes = line => /^\s*-{20,}\s*$/u.test(line);
const orientation = line => /orientation:\s*$/u.test(line);
const marker = /SCF Done:|on scan point|Optimization completed|Optimization stopped|Convergence failure|Start new reaction path calculation|Energy From Chk|path direction\.|Corrected End Point Energy|Beginning calculation of the REVERSE path|Normal termination|Error termination/u;
/** Keeps lines from `i` until `last` accepts one, and returns that line's index. */
const through = (i, last) => { for (; i < lines.length; i++) { keep[i] = true; if (last(i)) break; } return i; };

const first = lines.findIndex(orientation);
keep.fill(true, 0, first);
for (let i = first; i < lines.length; i++) {
  const line = lines[i];
  // A geometry table: heading, dashes, two header rows, dashes, atoms, dashes.
  if (orientation(line)) { let seen = 0; i = through(i, j => dashes(lines[j]) && ++seen === 3); }
  else if (/^\s*Point Number:/u.test(line) && /CURRENT STRUCTURE/u.test(lines[i + 1] ?? '')) i = through(i, j => /NET REACTION COORDINATE/u.test(lines[j]));
  else if (/Summary of reaction path following/u.test(line)) { keep[i - 2] = keep[i - 1] = true; i = through(i, j => j > i + 2 && dashes(lines[j])); }
  else if (/Summary of Optimized Potential Surface Scan/u.test(line)) i = through(i, j => !/^\s+(?:\d+\s+)*\d+\s*$|Eigenvalues --|EIGENVALUES --|^\s+[A-Z]+\d+\s/u.test(lines[j + 1] ?? ''));
  else if (marker.test(line)) keep[i] = true;
}
process.stdout.write(lines.filter((_, i) => keep[i]).join('\n'));
