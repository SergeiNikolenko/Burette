import { useTabWorkspaceStore } from "../../stores/tab-workspace-store";
import { DockPanelContent } from "../dock-panel";
import type { PageComponentProps } from "../editor-area/page-kinds/types";
import type { ToolLocation } from "../editor-area/page-kinds/tool";
import { FileViewerEmptyState } from "../ui/file-viewer-state";
import { Button } from "../ui/button";
import { useMoleculeStore } from "../../stores/molecule-store";

export function ToolPage({ location, state, actions, tabId }: PageComponentProps<ToolLocation>) {
  const drops = useTabWorkspaceStore(store => store.workspaces[tabId]?.droppedStructures);
  const source = location.sourcePath ? state.documents.find(document => document.path === location.sourcePath) ?? null : null;
  if (location.sourcePath && !source) return <div className="screen-stage"><FileViewerEmptyState title="Source unavailable" action={<Button variant="outline" size="sm" onClick={async () => {
    await actions.openStructurePaths([location.sourcePath!]);
    useMoleculeStore.getState().setActiveTab(tabId);
  }}>Reopen source</Button>} /></div>;
  const scoped = { ...state, activeDocument: source, rightDockDocumentId: source?.id ?? null, bottomDockDocumentId: source?.id ?? null,
    rightDockOpen: true, bottomDockOpen: true, rightDockTool: null, bottomDockTool: null };
  return <div className="screen-stage"><div className="dock-panel-body">
    <DockPanelContent area={location.area} activeTabKind={location.tool} state={scoped} actions={actions} dockDrops={drops ?? []} />
  </div></div>;
}
