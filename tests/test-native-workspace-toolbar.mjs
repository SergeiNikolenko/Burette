import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { Window } from 'happy-dom';
import ts from 'typescript';
import { prepareWorkspacePreview } from '../plugins/burette-agent/ui/native-workspace-preview.mjs';

test('native transport preserves the shared toolbar without injecting a second icon or tooltip implementation', async () => {
  const window = new Window();
  const previous = globalThis.DOMParser;
  globalThis.DOMParser = window.DOMParser;
  try {
    const toolbar = '<div id="buret-toolbar"><button data-buret-toggle="sequence">Seq</button><button data-buret-action="ketcher"><span data-buret-mode-icon="Edit"></span></button></div>';
    const output = prepareWorkspacePreview(`<html><head><script src="viewer-shell.js"></script><script src="viewer.js"></script></head><body>${toolbar}</body></html>`);
    const doc = new window.DOMParser().parseFromString(output, 'text/html');
    assert.equal(doc.querySelector('#buret-toolbar').outerHTML, toolbar);
    assert.deepEqual([...doc.querySelectorAll('[data-burette-script]')].map(el => el.dataset.buretteScript), ['viewer-shell.js', 'viewer.js']);
    assert.doesNotMatch(doc.body.lastElementChild.textContent, /installWorkspaceToolbar|insertAdjacentHTML|nativeHints|--buret-menu-accent/);
  } finally {
    globalThis.DOMParser = previous;
    await window.happyDOM.close();
  }
});

test('right dock message uses the existing workspace toggle only in the native widget', async () => {
  const source = await readFile(new URL('../apps/desktop/src/hooks/use-app-viewer-state-messages.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  for (const native of [false, true]) {
    const calls = [];
    const exports = {};
    runInNewContext(code, { exports, window: { BuretteMcpWorkspace: native ? {} : undefined }, require: name => name === 'react' ? { useCallback: fn => fn } : {} });
    const { handleViewerStateMessage } = exports.useAppViewerStateMessages({ toggleDock: area => calls.push(area) });
    handleViewerStateMessage('burette-viewer', { type: 'toggleRightDock' });
    assert.deepEqual(calls, native ? ['right'] : []);
  }
});
