import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript-compiler-api';
import * as preflight from '../apps/desktop/src/lib/conformer-input.ts';
import initializeExtractor from '../PreviewExtension/Web/rdkit-conformer/Burette_rdkit_conformer.js';

const water = readFileSync(new URL('../samples/mini.sdf', import.meta.url), 'utf8').split('$$$$', 1)[0] + '$$$$\n';
// Small synthetic fixture: retain the graph, coordinates and an alias while
// replacing one atom with the intentionally unspecified R-group test input.
const lines = water.split('\n');
lines[4] = `${lines[4].slice(0, 31)}R# ${lines[4].slice(34)}`;
const variable = lines.join('\n').replace('M  END', 'A    1\nR1\nM  END');
const source = Object.freeze({ extension: 'sdf', text: variable });
assert.throws(() => preflight.assertConcreteConformerSource(source), /fully specified molecule/);
assert.throws(() => preflight.assertConcreteConformerInput(variable.replaceAll('\n', '\r\n'), 'molblock'), /R-groups/);
assert.equal(source.text, variable);
assert.doesNotThrow(() => preflight.assertConcreteConformerSource({ extension: 'sdf', text: water + variable }));
assert.doesNotThrow(() => preflight.assertConcreteConformerInput(water.replace('M  END', 'A    1\nR1\nM  END'), 'molblock'));
assert.doesNotThrow(() => preflight.assertConcreteConformerInput(water + '\n> <Label>\nR# *\n', 'molblock'));
assert.doesNotThrow(() => preflight.assertConcreteConformerInput('CCO R* title', 'smiles'));
assert.doesNotThrow(() => preflight.assertConcreteConformerInput('CC[O-]', 'smiles'));
assert.doesNotThrow(() => preflight.assertConcreteConformerInput('invalid molblock', 'molblock'));
assert.throws(() => preflight.assertConcreteConformerInput('[*:1]CO', 'smiles'), /wildcard/);
const v3000 = '\nTest\n\n  0  0  0     0  0            999 V3000\nM  V30 BEGIN CTAB\nM  V30 COUNTS 1 0 0 0 0\nM  V30 BEGIN ATOM\nM  V30 1 R# 0 0 0 0\nM  V30 END ATOM\nM  V30 END CTAB\nM  END\n';
assert.throws(() => preflight.assertConcreteConformerInput(v3000, 'molblock'), /R-groups/);
assert.doesNotThrow(() => preflight.assertConcreteConformerInput(v3000.replace('1 R#', '1 C'), 'molblock'));

// Execute the real worker message handler. Only transport and module loading
// are injected; successful parameters come from the packaged WASM extractor.
const extractor = await initializeExtractor({ wasmBinary: readFileSync(new URL('../PreviewExtension/Web/rdkit-conformer/Burette_rdkit_conformer.wasm', import.meta.url)) });
let extracted = 0;
const module = {
  ...extractor,
  extract_conformer_parameters(...args) { extracted++; return extractor.extract_conformer_parameters(...args); },
};
const workerSource = readFileSync(new URL('../apps/desktop/src/workers/conformer-extract.worker.ts', import.meta.url), 'utf8')
  .replace('import.meta.url', JSON.stringify(import.meta.url));
const workerCode = ts.transpile(workerSource, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 });
let onMessage;
let receive;
new Function('require', 'exports', 'self', 'fetch', workerCode)(
  (name) => name.includes('conformer-input') ? preflight : { __esModule: true, default: async () => module },
  {},
  { addEventListener(_type, listener) { onMessage = listener; }, postMessage(message) { receive(message); } },
  async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }),
);
const send = (data) => new Promise((resolve) => { receive = resolve; onMessage({ data }); });
const response = await send({
  type: 'extractConformerChunk', requestId: 'mixed', chunk: {
    sessionId: '00000000-0000-0000-0000-000000000001', startOrdinal: 0,
    variant: 'ETKDGv3', mmffVariant: 'MMFF94s', maximumResultBytes: 100_000,
    records: [variable, water].map((input, ordinal) => ({ ordinal, sourceRecordId: ordinal + 1, moleculeContentSha256: '0'.repeat(64), input, format: 'molblock' })),
  },
});
assert.equal(response.error, undefined);
const view = new DataView(response.result);
const failedLength = view.getUint32(40 + 52, true);
assert.equal(view.getUint8(40 + 48), 1);
assert.match(new TextDecoder().decode(new Uint8Array(response.result, 104, failedLength)), /fully specified molecule/);
const second = Math.ceil((104 + failedLength) / 4) * 4;
assert.equal(view.getUint8(second + 48), 0, 'concrete record keeps its successful extraction');
assert.equal(extracted, 1, 'variable record never reaches the native extractor');
const standalone = await send({ type: 'extractStandaloneConformers', requestId: 'one', variant: 'ETKDGv3', mmffVariant: 'MMFF94s', records: [{ input: variable, format: 'molblock' }] });
assert.match(standalone.error, /fully specified molecule/);
assert.equal(extracted, 1);

// The browser entry point must reject before requesting the compute bridge,
// including optimization's explicit 3D source. Exercise its actual function.
const browserSource = readFileSync(new URL('../apps/desktop/src/lib/browser-dev-documents.ts', import.meta.url), 'utf8');
const browserFunction = browserSource.slice(browserSource.indexOf('export async function generateBrowserDev3DConformer('), browserSource.indexOf('async function openBrowserDevDocument('));
const browserExports = {};
let browserCalls = 0;
new Function('exports', 'assertConcreteConformerSource', 'runBrowserDevMetalConformer', ts.transpile(browserFunction, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }))(
  browserExports, preflight.assertConcreteConformerSource, async () => { browserCalls++; return 'control'; },
);
await assert.rejects(browserExports.generateBrowserDev3DConformer({ ...source, title: 'Variable' }), /fully specified molecule/);
await assert.rejects(browserExports.generateBrowserDev3DConformer({ extension: 'sdf', text: water, operation: 'optimize', source3d: source }), /fully specified molecule/);
assert.equal(browserCalls, 0);
assert.equal(await browserExports.generateBrowserDev3DConformer({ extension: 'sdf', text: water }), 'control');
assert.equal(browserCalls, 1);
console.log('Variable-atom preflight, source preservation, mixed worker envelope and real water extraction passed');
