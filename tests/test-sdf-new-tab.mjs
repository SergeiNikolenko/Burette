import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

test('opening a collection molecule adds a document without replacing the source tab', async () => {
  const source = await readFile(new URL('../apps/desktop/src/hooks/use-app-sdf-viewer-messages.ts', import.meta.url), 'utf8');
  const exports = {};
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, atob, Uint8Array, TextDecoder,
    require: name => name === 'react' ? { useCallback: fn => fn } : { isTauriRuntime: () => false },
  });
  const molecule = { id: 'extracted', path: 'burette-ketcher://fixture/ligand.sdf' };
  const added = [];
  const { handleSdfViewerMessage } = exports.useAppSdfViewerMessages({
    documents: [], preferences: {},
    openBrowserDevTextDocument: async () => molecule,
    addDocuments: docs => added.push(...docs),
    openDocumentsInActiveTab: () => assert.fail('must preserve collection tab'),
    rememberRecentStructures() {}, pushStatus() {},
    pushErrorStatus: error => assert.fail(String(error)),
  });
  assert.equal(await handleSdfViewerMessage({ type: 'openSdfMolstarDocument', title: 'ligand.sdf', textBase64: btoa('fixture molecule') }), true);
  assert.deepEqual(added, [molecule]);
});
