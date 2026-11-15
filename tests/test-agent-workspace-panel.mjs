import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setAgentRightPanel, setAgentWorkspacePanel } from '../apps/desktop/src/lib/agent-workspace-panel.ts';
import { useMoleculeStore } from '../apps/desktop/src/stores/molecule-store.ts';
import { useWorkspacePanesStore } from '../apps/desktop/src/stores/workspace-panes-store.ts';
import { useTabWorkspaceStore, WINDOW_TOOLS_ID } from '../apps/desktop/src/stores/tab-workspace-store.ts';

test('agent panel commands reuse the right group and preserve its document when hidden', () => {
  const documents = ['protein', 'ligand'].map(id => ({ id, path: `/${id}.pdb`, title: id, renderer: 'molstar' }));
  const tabs = documents.map(document => ({ id: document.id, location: { kind: 'file', documentId: document.id, path: document.path }, back: [], forward: [] }));
  useMoleculeStore.setState({ documents, textDocuments: [], tabs, activeTabId: 'protein' });
  useTabWorkspaceStore.setState({ workspaces: {} });
  useWorkspacePanesStore.setState({ selectedTabs: { main: 'protein' }, closedGroups: {}, fullViewTabId: null });
  const command = action => setAgentWorkspacePanel(action, useMoleculeStore.getState().activeTabId, useMoleculeStore.getState().tabs);
  for (const area of ['right', 'bottom']) {
    const result = command({ area, open: true, documentId: 'ligand' });
    assert.deepEqual(result, { ok: true, command: 'set_workspace_panel', result: { area, open: true, documentId: 'ligand' } });
    assert.equal(command({ area, open: false }).result.open, false);
  }
  assert.equal(useMoleculeStore.getState().tabs.filter(tab => tab.pane === 'right').length, 1);
  assert.equal(useTabWorkspaceStore.getState().workspaces[WINDOW_TOOLS_ID].bottom.open, false);
  const rightId = useMoleculeStore.getState().tabs.find(tab => tab.pane === 'right').id;
  assert.equal(command({ area: 'right', open: true }).result.documentId, 'ligand');
  command({ area: 'right', open: true, documentId: 'ligand' });
  assert.deepEqual(useMoleculeStore.getState().tabs.filter(tab => tab.pane === 'right').map(tab => tab.id), [rightId]);
  assert.equal(useMoleculeStore.getState().tabs.find(tab => tab.id === 'ligand').pane, undefined);
  for (const action of [{ area: 'left', open: true }, { area: 'right', open: 'true' }, { area: 'bottom', open: true, documentId: 'foreign' }]) {
    assert.equal(command(action).ok, false);
  }
});

test('assigning a document to a closed right panel preserves the focused main tab and its full view', () => {
  const documents = ['protein', 'ligand'].map(id => ({ id, path: `/${id}.pdb`, title: id, renderer: 'molstar' }));
  const tabs = documents.map(document => ({ id: document.id, location: { kind: 'file', documentId: document.id, path: document.path }, back: [], forward: [] }));
  useMoleculeStore.setState({ documents, textDocuments: [], tabs, activeTabId: 'protein' });
  useWorkspacePanesStore.setState({ selectedTabs: { main: 'protein' }, closedGroups: { right: true }, fullViewTabId: 'protein' });
  assert.deepEqual(setAgentWorkspacePanel({ area: 'right', open: false, documentId: 'ligand' }, 'protein', tabs).result,
    { area: 'right', open: false, documentId: 'ligand' });
  assert.equal(useMoleculeStore.getState().activeTabId, 'protein');
  assert.equal(useWorkspacePanesStore.getState().fullViewTabId, 'protein');
});

test('showing a report in the right panel keeps the main molecule available to viewer actions', () => {
  const molecule = { id: 'protein', path: '/protein.pdb', title: 'Protein', renderer: 'molstar' };
  const report = { id: 'report', path: '/report.md', title: 'Report' };
  const tab = { id: 'molecule', location: { kind: 'file', documentId: molecule.id, path: molecule.path }, back: [], forward: [] };
  useMoleculeStore.setState({ documents: [molecule], textDocuments: [report], tabs: [tab], activeTabId: tab.id, activeDocumentId: molecule.id });
  useWorkspacePanesStore.setState({ selectedTabs: { main: tab.id }, closedGroups: { right: true }, fullViewTabId: null });
  setAgentRightPanel(true, report.id);
  const model = useMoleculeStore.getState();
  const panes = useWorkspacePanesStore.getState();
  assert.equal(model.activeDocumentId, molecule.id);
  assert.equal(model.activeTabId, tab.id);
  assert.equal(panes.closedGroups.right, false);
  assert.deepEqual(model.tabs.find(tab => tab.id === panes.selectedTabs.right)?.location,
    { kind: 'text-file', path: report.path, documentId: report.id });
});
