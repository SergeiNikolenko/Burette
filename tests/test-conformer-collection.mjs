import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const exports = {};
new Function('exports', ts.transpile(readFileSync('apps/desktop/src/lib/conformer-collection.ts', 'utf8'), {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
}))(exports);
const { conformerCollectionSdf } = exports;
const record = (name, element) => `${name}\n  Burette           2D\n\n  1  0  0  0  0  0            999 V2000\n    0.0000    0.0000    0.0000 ${element.padEnd(3)} 0  0  0  0  0\nM  END\n>  <PATENT_PAGE>\n7\n\n$$$$\n`;
const frame = (index, element, x, status = 'passed') => `1\nBurette conformer molecule=${index} energyRank=1 stereo=${status}\n${element} ${x} 2 3\n`;
const source = record('', 'C') + record('second', 'N');
const result = conformerCollectionSdf(source, frame(1, 'N', 4) + frame(0, 'C', 1));
assert.equal(result, source.replace(/2D/g, '3D')
  .replace('    0.0000    0.0000    0.0000 C', '    1.0000    2.0000    3.0000 C')
  .replace('    0.0000    0.0000    0.0000 N', '    4.0000    2.0000    3.0000 N'));
assert.equal(conformerCollectionSdf(source, frame(0, 'C', 1, 'failed')), source);
assert.equal(conformerCollectionSdf(source, frame(0, 'C', 1)).split('$$$$').length, 3);
assert.equal(conformerCollectionSdf(source, frame(0, 'C', 1) + frame(0, 'C', 4), true).split('$$$$').length, 4);
assert.throws(() => conformerCollectionSdf(source, frame(0, 'O', 1)), /atom order/);
assert.throws(() => conformerCollectionSdf(source, frame(2, 'C', 1)), /unknown source/);
assert.throws(() => conformerCollectionSdf(source, frame(0, 'C', 'NaN')), /coordinates/);
const v3 = '\n  Burette           2D\n\n  0  0  0     0  0            999 V3000\nM  V30 BEGIN CTAB\nM  V30 COUNTS 1 0 0 0 0\nM  V30 BEGIN ATOM\nM  V30 1 N 0 0 0 0 CHG=1\nM  V30 END ATOM\nM  V30 END CTAB\nM  END\n$$$$\n';
assert.equal(conformerCollectionSdf(v3, frame(0, 'N', 1)), v3.replace('2D', '3D').replace('N 0 0 0 0 CHG=1', 'N 1 2 3 0 CHG=1'));
console.log('conformer collection preservation passed');

// Exercise the native Generate 3D bridge: it must open SDF in the active tab,
// preserving style and history, rather than opening the XYZ artifact.
const hookExports = {};
const calls = [];
const nativeXyz = frame(0, 'C', 1) + frame(1, 'N', 4);
new Function('require', 'exports', ts.transpile(readFileSync('apps/desktop/src/hooks/use-app-generate-3d-conformer.ts', 'utf8'), {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
}))(name => {
  if (name === 'react') return { useCallback: callback => callback };
  if (name === '@tauri-apps/api/core') return { invoke: async (command, args) => {
    assert.equal(command, 'open_text_structure');
    calls.push(args);
    return { id: '3d', path: '/derived/source.sdf', ...args.request };
  } };
  if (name === '../lib/tauri') return { isTauriRuntime: () => true };
  if (name === '../lib/conformer-collection') return exports;
  if (name === '../lib/conformer-generation') return { conformerGenerationTaskLabel: () => '3D conformer' };
  if (name === '../lib/browser-dev-compute') return {};
  if (name === '../lib/browser-dev-documents') return { readBrowserDevVirtualTextDocument: () => null };
  if (name === '../lib/structure-text') return { readStructureText: async path => path.endsWith('.xyz') ? nativeXyz : source };
  if (name === '../lib/standalone-compute') return { runStandaloneConformerWorkflow: async () => ({ primaryOpenPath: '/conformers.xyz', reportPath: '/report.md', passedCount: 2, failedCount: 0, backend: 'nativeMetal' }) };
  throw new Error(name);
}, hookExports);
let opened;
const { generate3DConformer } = hookExports.useAppGenerate3DConformer({
  preferences: { molstarStyle: 'default' }, pendingMolstarReplaceRef: { current: new Map() },
  openDocuments: () => assert.fail('Must not open XYZ for an SDF collection'),
  openDocumentsInActiveTab: (documents, options) => { opened = { documents, options }; },
  openTextDocuments() {}, rememberRecentStructures() {}, pushStatus() {},
  pushErrorStatus: error => { throw error; },
});
await generate3DConformer({ id: 'source', path: '/source.sdf', title: 'source.sdf', extension: 'sdf', renderer: 'molstar' }, 'single', 'illustrative');
assert.deepEqual(calls, [{ request: { title: 'source.sdf', extension: 'sdf', text: result }, preferences: { rendererMode: 'molstar', molstarStyle: 'illustrative' }, reloadOptions: {} }]);
assert.deepEqual(opened.options, { backLocation: { kind: 'file', documentId: 'source', path: '/source.sdf' } });
assert.equal(opened.documents[0].extension, 'sdf');
console.log('native conformer collection bridge passed');
