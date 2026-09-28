import { expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rewriteEmbindForCsp } from '../apps/desktop/vite/native-workspace-csp';

test('current Indigo uses native closures and needs no dynamic-code rewrite', () => {
  const dir = fileURLToPath(new URL('../apps/desktop/node_modules/ketcher-standalone/dist/binaryWasm', import.meta.url));
  const file = readdirSync(dir).find(name=>/^indigoWorker-.*\.js$/.test(name))!;
  const code = readFileSync(join(dir,file),'utf8');
  expect(rewriteEmbindForCsp(code)).toBe(code);
  expect(()=>rewriteEmbindForCsp(code+';new Function("return 1")')).toThrow();
});
test('unknown embind layouts still fail closed', () => {
  expect(()=>rewriteEmbindForCsp('function craftInvokerFunction(){} var __embind_register_class_constructor=0;')).toThrow();
});

for (const engine of ['@rdkit/rdkit','rdkit-compute']) test(`${engine} builds molecules without dynamic code under strict CSP`, async () => {
  const { runInNewContext } = await import('node:vm');
  const root = fileURLToPath(new URL(`../node_modules/${engine}/dist/`, import.meta.url));
  const code = rewriteEmbindForCsp(readFileSync(join(root,'RDKit_minimal.js'),'utf8'));
  expect(code).not.toMatch(/new Function/);
  const context = { console, TextDecoder, TextEncoder, WebAssembly, setTimeout, clearTimeout };
  const init = runInNewContext(code+';initRDKitModule',context,{codeGeneration:{strings:false,wasm:true}});
  const wasm = new WebAssembly.Module(readFileSync(join(root,'RDKit_minimal.wasm')));
  const rdkit = await init({instantiateWasm(imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance) => void) { const instance = new WebAssembly.Instance(wasm,imports); receive(instance); return instance.exports; }});
  const mol = rdkit.get_mol('CC(=O)Oc1ccccc1C(=O)O');
  try { expect(mol.get_smiles()).toContain('Oc1ccccc1'); expect(JSON.parse(mol.get_descriptors()).NumAtoms).toBeGreaterThan(10); expect(mol.get_svg()).toContain('<svg'); }
  finally { mol.delete(); }
}, 30000);
