import { useTabWorkspaceStore, WINDOW_TOOLS_ID } from '../stores/tab-workspace-store';
import { useMoleculeStore, type MoleculeTab } from '../stores/molecule-store';
import { useWorkspacePanesStore } from '../stores/workspace-panes-store';
import { openRightDocument, rightPanelSelection, setRightPanelOpen } from './right-workspace-panel';

export function setAgentRightPanel(open: boolean, documentId?: string) {
  const model = useMoleculeStore.getState();
  const rightFocused = model.tabs.some(tab => tab.id === model.activeTabId && tab.pane === 'right');
  const assigned = documentId ? openRightDocument(documentId, open && rightFocused) : undefined;
  setRightPanelOpen(open);
  if (assigned) useWorkspacePanesStore.getState().selectTab('right', assigned);
}

export function setAgentWorkspacePanel(action: Record<string, unknown>, activeTabId: string | null | undefined, tabs: MoleculeTab[]) {
  const fail = (message: string) => ({ ok: false, command: 'set_workspace_panel', error: { code: 'INVALID_ARGS', message } });
  if (!activeTabId || !tabs.some(tab => tab.id === activeTabId)) return fail('No active workspace tab.');
  if (action.area !== 'right' && action.area !== 'bottom') return fail('area must be right or bottom.');
  if (typeof action.open !== 'boolean') return fail('open must be a boolean.');
  const document = action.documentId === undefined ? undefined : tabs.find(tab => tab.location.kind === 'file' && tab.location.documentId === action.documentId);
  if (action.documentId !== undefined && !document) return fail('documentId must belong to an open molecular tab.');
  if (action.area === 'right') {
    setAgentRightPanel(action.open, document?.location.kind === 'file' ? document.location.documentId : undefined);
    const panes = useWorkspacePanesStore.getState();
    const model = useMoleculeStore.getState();
    const selected = rightPanelSelection(model.tabs, model.activeTabId, panes.selectedTabs.right);
    const location = selected?.location;
    const documentId = location?.kind === 'file' || location?.kind === 'text-file' ? location.documentId ?? null
      : location?.kind === 'tool' && location.sourcePath
        ? model.documents.find(item => item.path === location.sourcePath)?.id ?? null : null;
    return { ok: true, command: 'set_workspace_panel', result: {
      area: 'right', open: Boolean(selected && !panes.closedGroups.right), documentId,
    } };
  }
  const workspace = useTabWorkspaceStore.getState();
  if (document?.location.kind === 'file' && document.location.documentId) workspace.setDockDocument(activeTabId, action.area, document.location.documentId);
  workspace.setDockOpen(activeTabId, action.area, action.open);
  const panel = useTabWorkspaceStore.getState().workspaces[action.area === "bottom" ? WINDOW_TOOLS_ID : activeTabId]?.[action.area];
  return { ok: true, command: 'set_workspace_panel', result: { area: action.area, open: panel?.open ?? false, documentId: panel?.documentId ?? null } };
}
