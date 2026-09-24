import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

test('panel action routes open documents to either dock and rejects foreign targets', async () => {
  const source = await readFile(new URL('../apps/desktop/src/lib/agent-workspace-panel.ts', import.meta.url), 'utf8');
  const workspaces = { active: { right: { open: false }, bottom: { open: false } } };
  const state = { workspaces, setDockDocument: (tab, area, documentId) => { workspaces[tab][area].documentId = documentId; }, setDockOpen: (tab, area, open) => { workspaces[tab][area].open = open; } };
  const exports = {};
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require: () => ({ useTabWorkspaceStore: { getState: () => state } }) });
  const tabs = [{ id: 'active', location: { kind: 'file', documentId: 'protein' } }, { id: 'second', location: { kind: 'file', documentId: 'ligand' } }];
  for (const area of ['right', 'bottom']) {
    const result = exports.setAgentWorkspacePanel({ area, open: true, documentId: 'ligand' }, 'active', tabs);
    assert.deepEqual(structuredClone(result), { ok: true, command: 'set_workspace_panel', result: { area, open: true, documentId: 'ligand' } });
    assert.equal(exports.setAgentWorkspacePanel({ area, open: false }, 'active', tabs).result.open, false);
  }
  for (const action of [{ area: 'left', open: true }, { area: 'right', open: 'true' }, { area: 'bottom', open: true, documentId: 'foreign' }]) {
    assert.equal(exports.setAgentWorkspacePanel(action, 'active', tabs).ok, false);
  }
});
