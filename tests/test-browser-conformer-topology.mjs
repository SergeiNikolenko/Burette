import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript-compiler-api';
import initializeExtractor from '../PreviewExtension/Web/rdkit-conformer/Burette_rdkit_conformer.js';
import { parseNativeConformerParameters } from '../apps/desktop/src/lib/conformer-extractor.ts';

const require = createRequire(import.meta.url);
const initRDKit = require('@rdkit/rdkit');
const rdkit = await initRDKit();
const extractor = await initializeExtractor({ wasmBinary: readFileSync('PreviewExtension/Web/rdkit-conformer/Burette_rdkit_conformer.wasm') });
const source = readFileSync('apps/desktop/src/lib/browser-dev-compute.ts', 'utf8');
const start = source.indexOf('function standaloneExtractionRecords(');
const end = source.indexOf('\nfunction extractStandaloneConformers(', start);
const declaration = source.slice(start, end);
const prepare = new Function('loadRDKitModule', ts.transpile(
  (source.slice(start - 6, start) === 'async ' ? 'async ' : '') + declaration + '\nreturn standaloneExtractionRecords;',
  { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
))(async () => rdkit);
for (const smiles of ['CCO', 'C[NH2+]C', 'N[C@@H](C)C(=O)O', 'F/C=C/F']) {
  const [record] = await prepare({ extension: 'smi', text: smiles });
  assert.equal(record.format, 'molblock', 'SMILES must carry a chemical graph into the coordinate writer');
  const original = rdkit.get_mol(smiles);
  const restored = rdkit.get_mol(record.input);
  const expected = rdkit.get_mol(original.add_hs());
  try {
    assert.ok(restored?.is_valid());
    const bytes = extractor.extract_conformer_parameters(record.input, 0, 6);
    const parameters = parseNativeConformerParameters(bytes, 'ETKDGv3', bytes.byteLength);
    assert.equal(parameters.atomicNumbers.length, Number(record.input.split('\n')[3].slice(0, 3)), 'template and native coordinates must use identical atom indices');
    assert.equal(restored.get_smiles(), expected.get_smiles(), 'bonds, charges and stereochemistry must survive');
    assert.ok(Number(record.input.split('\n')[3].slice(3, 6)) > 0);
  } finally { original.delete(); expected.delete(); restored?.delete(); }
}
console.log('Browser conformer templates preserve bonds, charge and stereochemistry');

const unnamed = rdkit.get_mol('CCO');
const block = unnamed.get_molblock();
unnamed.delete();
const sdfRecords = await prepare({ extension: 'sdf', text: `${block}\n$$$$\n${block}\n$$$$\n` });
assert.equal(sdfRecords.length, 2);
for (const record of sdfRecords) {
  const molecule = rdkit.get_mol(record.input);
  assert.ok(molecule?.is_valid(), 'empty molecule titles must preserve the MOL header');
  molecule?.delete();
}
