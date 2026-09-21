import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { test } from 'node:test';
import { rewriteEmbindForCsp, nativeWorkspaceCspPlugin } from '../apps/desktop/vite/native-workspace-csp.ts';

test('packaged RDKit parses, renders and releases molecules without string code generation', async () => {
  const file = new URL('../PreviewExtension/Web/rdkit/RDKit_minimal.js', import.meta.url);
  const context = vm.createContext({ module: { exports: {} }, require: createRequire(file), process, console, __dirname: new URL('.', file).pathname, TextDecoder, TextEncoder, Buffer }, { codeGeneration: { strings: false, wasm: true } });
  vm.runInContext(rewriteEmbindForCsp(await readFile(file, 'utf8')), context);
  const rdkit = await context.initRDKitModule({ wasmBinary: await readFile(new URL('RDKit_minimal.wasm', file)) });
  const molecule = rdkit.get_mol('c1ccccc1O');
  try {
    assert.equal(molecule.get_num_atoms(), 7);
    assert.match(molecule.get_svg(), /<svg/u);
    assert.equal(JSON.parse(molecule.get_descriptors()).NumAromaticRings, 1);
  } finally { molecule.delete(); }
});

test('CSP substitutions fail closed on changed glue and do not affect unrelated modules', () => {
  assert.throws(() => rewriteEmbindForCsp('function craftInvokerFunction(){}'), /layout changed/u);
  assert.equal(nativeWorkspaceCspPlugin().transform.call({}, 'export const value=1', '/app/regular.js'), null);
});
