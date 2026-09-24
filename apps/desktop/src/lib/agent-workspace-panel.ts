import { useTabWorkspaceStore } from '../stores/tab-workspace-store';
import type { MoleculeTab } from '../stores/molecule-store';

export function setAgentWorkspacePanel(action: Record<string, unknown>, activeTabId: string | null | undefined, tabs: MoleculeTab[]) {
  const fail = (message: string) => ({ ok: false, command: 'set_workspace_panel', error: { code: 'INVALID_ARGS', message } });
  if (!activeTabId || !tabs.some(tab => tab.id === activeTabId)) return fail('No active workspace tab.');
  if (action.area !== 'right' && action.area !== 'bottom') return fail('area must be right or bottom.');
  if (typeof action.open !== 'boolean') return fail('open must be a boolean.');
  const document = action.documentId === undefined ? undefined : tabs.find(tab => tab.location.kind === 'file' && tab.location.documentId === action.documentId);
  if (action.documentId !== undefined && !document) return fail('documentId must belong to an open molecular tab.');
  const workspace = useTabWorkspaceStore.getState();
  if (document?.location.kind === 'file' && document.location.documentId) workspace.setDockDocument(activeTabId, action.area, document.location.documentId);
  workspace.setDockOpen(activeTabId, action.area, action.open);
  const panel = useTabWorkspaceStore.getState().workspaces[activeTabId]?.[action.area];
  return { ok: true, command: 'set_workspace_panel', result: { area: action.area, open: panel?.open ?? false, documentId: panel?.documentId ?? null } };
}
