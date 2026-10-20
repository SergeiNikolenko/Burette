import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import initRDKit from '@rdkit/rdkit';
import { prepareKetcherPdbImport } from '../apps/desktop/src/lib/ketcher-pdb-import.ts';
import { prepareKetcherPdb } from '../apps/desktop/vite/browser-dev/ketcher-pdb.ts';
import { validatePdbConversion, validatePdbMolecule } from '../apps/desktop/src/lib/pdb-chemistry.ts';

// Remove all chemistry from a known 3D molecule, then compare reconstructed
// chemistry independently with RDKit. This integration test needs Open Babel.
const sdf = readFileSync('samples/structures/small-molecules/caffeine.sdf', 'utf8');
assert.equal(await prepareKetcherPdbImport(sdf), sdf);
const blankTitleSdf = sdf.slice(sdf.indexOf('\n'));
assert.equal(await prepareKetcherPdbImport(blankTitleSdf), blankTitleSdf);
const lines = sdf.split('\n');
const count = Number(lines[3].slice(0, 3));
const pdb = lines.slice(4, 4 + count).map((line, i) => {
  const element = line.slice(31, 34).trim();
  const xyz = [0, 10, 20].map(offset => Number(line.slice(offset, offset + 10)).toFixed(3).padStart(8)).join('');
  return `HETATM${String(i + 1).padStart(5)}  ${element.padEnd(3)} LIG L   1    ${xyz}  1.00  0.00          ${element.padStart(2)}`;
}).join('\n') + '\nEND\n';
let converted;
try { converted = await prepareKetcherPdb(pdb); }
catch (error) {
  if (!String(error).includes('Install Open Babel')) throw error;
  console.log('SKIP chemical perception: Open Babel is not installed');
}
if (converted) {
const rdkit = await initRDKit();
const originalMol = rdkit.get_mol(sdf), convertedMol = rdkit.get_mol(converted);
try {
  assert.ok(originalMol && convertedMol);
  assert.equal(convertedMol.get_smiles(), originalMol.get_smiles());
} finally { originalMol?.delete(); convertedMol?.delete(); }
assert.equal(validatePdbConversion(pdb, converted), converted);
}
assert.throws(() => validatePdbConversion(pdb, sdf.replace('0.4700', '9.4700')), /coordinates/);
assert.throws(() => validatePdbMolecule('END\n'), /1–300/);
assert.throws(() => validatePdbMolecule('MODEL        1\n' + pdb + 'MODEL        2\n' + pdb), /one model/);

// PDB CONECT repeats targets to express multiplicity. Reverse records do not
// double it, and selecting a residue must retain the repeated targets.
const viewer = readFileSync('PreviewExtension/Web/viewer.js', 'utf8');
const source = name => {
  const match = viewer.match(new RegExp(`\\n  (?:async )?function ${name}\\([\\s\\S]*?\\n  \\}`, 'u'));
  assert.ok(match, name);
  return match[0];
};
const pairs = new Function(source('pdbConectPairsForSerials') + ';return pdbConectPairsForSerials;')();
assert.deepEqual(pairs('CONECT    1    2    2\nCONECT    2    1    1    3    3    3\nCONECT    3    2    2    2\n', new Set([1, 2, 3])), [
  { a: 1, b: 2, order: 2 }, { a: 2, b: 3, order: 3 },
]);
const filter = new Function(source('pdbSerialFromLine') + source('filteredPdbConectLine') + ';return filteredPdbConectLine;')();
assert.equal(filter('CONECT    1    2    2    9', new Set([1, 2])), 'CONECT    1    2    2');
const payload = new Function('pdbEntryForResidue', 'normalizeFormat', source('molstarContextDocumentPayload') + ';return molstarContextDocumentPayload;')(
  () => ({data:pdb,format:'pdb',label:'LIG L 1'}), value => value,
);
assert.equal(payload({scope:'ligand',selectedEntry:{},sourceEntry:{},atom:{}}).entries[0].data, pdb);
console.log('Ketcher PDB transfer checks passed' + (converted ? ' (including caffeine chemistry and 3D coordinates)' : ' (without chemical perception)'));
