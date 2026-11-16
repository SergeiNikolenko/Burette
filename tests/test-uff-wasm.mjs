import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import initialize from '../PreviewExtension/Web/rdkit-conformer/Burette_rdkit_conformer.js';
import ts from 'typescript-compiler-api';

assert.equal(readFileSync(new URL('../PreviewExtension/Web/rdkit-conformer/Burette_rdkit_conformer.d.ts', import.meta.url), 'utf8'),
  readFileSync(new URL('../compute/rdkit-conformer/Burette_rdkit_conformer.d.ts', import.meta.url), 'utf8'), 'shipped declarations match their authored build source');

const fixture = JSON.parse(readFileSync(new URL('../compute/rdkit-conformer/fixtures/uff-rdkit-2025.03.4.json', import.meta.url)));
const wasmBinary = readFileSync(new URL('../PreviewExtension/Web/rdkit-conformer/Burette_rdkit_conformer.wasm', import.meta.url));
const start = performance.now();
let memory;
const compiled = new WebAssembly.Module(wasmBinary);
const module = await initialize({ wasmBinary, instantiateWasm(imports, receive) {
  const instance = new WebAssembly.Instance(compiled, imports);
  memory = Object.values(instance.exports).find((value) => value instanceof WebAssembly.Memory);
  receive(instance);
  return instance.exports;
} });
const initializationMs = performance.now() - start;
assert.equal(module.uff_evaluator_abi_version(), 1);
assert.equal(module.rdkit_source_revision(), `Release_2025_03_4@${fixture.rdkitCommit}`);
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) < tolerance, `${label}: ${actual} versus ${expected}`);
let maximumGradientError = 0;
const times = [];
for (const item of fixture.cases) {
  const created = module.create_uff_evaluator(item.molblock);
  assert.equal(created.error, undefined, item.name);
  const context = created.context;
  try {
    assert.equal(context.atom_count(), item.atomCount, `${item.name}: no hydrogen invention`);
    const coordinates = new Float64Array(item.coordinates);
    const time = performance.now();
    const evaluated = context.evaluate(coordinates);
    times.push(performance.now() - time);
    assert.equal(evaluated.error, undefined, item.name);
    near(evaluated.energyKcalMol, item.expectedEnergyKcalMol, 1e-8, `${item.name} energy`);
    assert.equal(evaluated.gradient.length, coordinates.length);
    for (let i = 0; i < coordinates.length; i++) {
      near(evaluated.gradient[i], item.expectedGradientKcalMolAngstrom[i], 1e-7, `${item.name} gradient ${i}`);
      const step = 1e-5;
      coordinates[i] += step;
      const plus = context.evaluate(coordinates).energyKcalMol;
      coordinates[i] -= 2 * step;
      const minus = context.evaluate(coordinates).energyKcalMol;
      coordinates[i] += step;
      const error = Math.abs(evaluated.gradient[i] - (plus - minus) / (2 * step));
      maximumGradientError = Math.max(maximumGradientError, error);
      assert.ok(error < 3e-5, `${item.name}: finite difference gradient ${i}, error ${error}`);
    }
    near(context.evaluate(coordinates).energyKcalMol, evaluated.energyKcalMol, 1e-9, 'reused field resets distance cache');
    assert.match(context.evaluate(new Float64Array(1)).error, /exactly 3/);
    for (const invalid of [NaN, Infinity, 1e6 + 1]) {
      const bad = new Float64Array(coordinates);
      bad[0] = invalid;
      assert.match(context.evaluate(bad).error, /finite/);
    }
  } finally { context.delete(); }
}
for (const item of fixture.gasteigerCases) {
  const result = module.compute_gasteiger_charges(item.molblock);
  assert.equal(result.error, undefined, item.name);
  assert.equal(result.charges.length, item.charges.length);
  result.charges.forEach((charge, index) => near(charge, item.charges[index], 1e-12, `${item.name} charge ${index}`));
}

const water = fixture.cases[0];
assert.match(module.create_uff_evaluator('invalid').error, /parse|conformer|MOL/i);
assert.match(module.create_uff_evaluator('x'.repeat(2 * 1024 * 1024 + 1)).error, /2 MiB/);
const tooManyAtoms = `\nBurette\n\n  0  0  0     0  0            999 V3000\nM  V30 BEGIN CTAB\nM  V30 COUNTS 1025 0 0 0 0\nM  V30 BEGIN ATOM\n${Array.from({ length: 1025 }, (_, index) => `M  V30 ${index + 1} H ${index} 0 0 0`).join('\n')}\nM  V30 END ATOM\nM  V30 END CTAB\nM  END\n`;
assert.match(module.create_uff_evaluator(tooManyAtoms).error, /1024 atoms/);
const wildcard = water.molblock.replace(/ O /, ' * ');
assert.match(module.create_uff_evaluator(wildcard).error, /parameters/);
assert.match(module.compute_gasteiger_charges(wildcard).error, /parameter|Gasteiger/i);
// Exercise capacity, failure cleanup, and repeat create/evaluate/dispose. A leaked
// molecule/field or failed-construction slot causes subsequent admission to fail.
for (let repeat = 0; repeat < 256; repeat++) {
  const created = module.create_uff_evaluator(water.molblock);
  assert.equal(created.error, undefined);
  created.context.evaluate(new Float64Array(water.coordinates));
  created.context.delete();
}
const contexts = Array.from({ length: 8 }, () => module.create_uff_evaluator(water.molblock).context);
try { assert.match(module.create_uff_evaluator(water.molblock).error, /8 living contexts/); }
finally { contexts.forEach((context) => context.delete()); }
assert.ok(memory instanceof WebAssembly.Memory);
const warmedHeapBytes = memory.buffer.byteLength;
for (let repeat = 0; repeat < 1024; repeat++) {
  const { context } = module.create_uff_evaluator(water.molblock);
  context.evaluate(new Float64Array(water.coordinates));
  context.delete();
}
assert.equal(memory.buffer.byteLength, warmedHeapBytes, 'disposed contexts reuse the warmed WASM heap');

// Execute the authored adapter with the actual WASM module. Transport alone is
// injected so Node can exercise the same synchronous preparation/disposal API.
const adapterSource = readFileSync(new URL('../apps/desktop/src/lib/molecular-workbench/uff-wasm.ts', import.meta.url), 'utf8')
  .replaceAll('import.meta.url', JSON.stringify(import.meta.url));
const adapterCode = ts.transpile(adapterSource, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 });
const adapter = {};
let fetchCount = 0, finishFetch;
new Function('require', 'exports', 'fetch', adapterCode)(
  () => ({ __esModule: true, default: async () => module }), adapter,
  () => { fetchCount++; return new Promise(resolve => { finishFetch = resolve; }); },
);
assert.throws(() => adapter.createUffWasmEvaluator(water.molblock), /prepared/);
const failed = adapter.prepareUffWasm();
assert.equal(adapter.prepareUffWasm(), failed, 'pending preparation shares its first fetch');
assert.equal(fetchCount, 1);
assert.throws(() => adapter.createUffWasmEvaluator(water.molblock), /prepared/);
finishFetch({ ok: false, status: 503 });
await assert.rejects(failed, /Cannot load UFF \(503\)/);
assert.throws(() => adapter.createUffWasmEvaluator(water.molblock), /prepared/);
const retry = adapter.prepareUffWasm();
assert.notEqual(retry, failed, 'failed preparation clears its cached promise');
assert.equal(adapter.prepareUffWasm(), retry);
assert.equal(fetchCount, 2);
assert.throws(() => adapter.createUffWasmEvaluator(water.molblock), /prepared/);
finishFetch({ ok: true, arrayBuffer: async () => wasmBinary });
await retry;
await adapter.prepareUffWasm();
assert.equal(fetchCount, 2, 'successful preparation remains cached');
const evaluator = adapter.createUffWasmEvaluator(water.molblock);
assert.equal(evaluator.atomCount, water.atomCount);
near(evaluator.evaluate(new Float64Array(water.coordinates)).energyKcalMol, water.expectedEnergyKcalMol, 1e-8, 'adapter energy');
evaluator.dispose();
evaluator.dispose();
assert.throws(() => evaluator.evaluate(new Float64Array(water.coordinates)), /disposed/);
// Existing parameter payloads must retain their exact ABI and frozen bytes.
assert.equal(module.conformer_extractor_abi_version(), 1);
assert.equal(module.mmff_extractor_abi_version(), 1);
const conformers = JSON.parse(readFileSync(new URL('../compute/rdkit-conformer/fixtures/conformer-rdkit-2025.03.4.json', import.meta.url)));
const variants = ['DG', 'KDG', 'ETDG', 'ETDGv2', 'ETKDG', 'ETKDGv2', 'ETKDGv3', 'srETKDGv3'];
for (const item of conformers.cases) {
  assert.deepEqual(Buffer.from(module.extract_conformer_parameters(item.smiles, 1, variants.indexOf(item.variant))), Buffer.from(item.bcexBase64, 'base64'));
}
const mmff = JSON.parse(readFileSync(new URL('../compute/rdkit-conformer/fixtures/mmff-rdkit-2025.03.4.json', import.meta.url)));
for (const item of mmff.cases) {
  assert.deepEqual(Buffer.from(module.extract_mmff_parameters(item.molblock, 0, item.variant === 'MMFF94' ? 0 : 1)), Buffer.from(item.bmfxBase64, 'base64'));
}
times.sort((a, b) => a - b);
console.log(JSON.stringify({ cases: fixture.cases.length, gasteigerCases: fixture.gasteigerCases.length, maximumGradientError, initializationMs, evaluationMedianMs: times[Math.floor(times.length / 2)], wasmBytes: wasmBinary.length, warmedHeapBytes }));
