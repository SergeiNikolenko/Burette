import { useRef } from "react";
import { useTabWorkspaceStore } from "../../stores/tab-workspace-store";
import { DockPanelContent } from "../dock-panel";
import type { PageComponentProps } from "../editor-area/page-kinds/types";
import type { ToolLocation } from "../editor-area/page-kinds/tool";
import { FileViewerEmptyState } from "../ui/file-viewer-state";
import { Button } from "../ui/button";
import { useMoleculeStore } from "../../stores/molecule-store";
import { useWorkspacePanesStore } from "../../stores/workspace-panes-store";
import { FileBrowser } from "../sidebar/file-browser";
import { TooltipProvider } from "../ui/tooltip";
import { selectedGroupTab } from "./use-pane-tabs";

export function ToolPage({ location, state, actions, tabId, isActive }: PageComponentProps<ToolLocation>) {
  const drops = useTabWorkspaceStore(store => store.workspaces[tabId]?.droppedStructures);
  const mainId = useWorkspacePanesStore(store => isActive ? store.selectedTabs.main : undefined);
  const main = useRef<ReturnType<typeof selectedGroupTab> | undefined>(undefined);
  if (isActive) main.current = selectedGroupTab(state.tabs, state.activeTabId, { main: mainId }, "main");
  // Hidden tool pages keep local controls after the first visit. They neither
  // prefetch on restore nor follow main-tab changes until shown again.
  if (main.current === undefined) return null;
  const dropKind = location.area === "right" ? location.tool : undefined;
  if (location.area === "right" && location.tool === "files") {
    return <div className="screen-stage" data-workspace-tool-drop={dropKind}><TooltipProvider delayDuration={350}>
      <FileBrowser state={state} actions={actions} presentation="panel" />
    </TooltipProvider></div>;
  }
  const sourceTab = location.sourcePath
    ? state.tabs.find(tab => "path" in tab.location && tab.location.path === location.sourcePath) ?? null
    : main.current;
  const sourceLocation = sourceTab?.location;
  const path = location.sourcePath ?? (sourceLocation && "path" in sourceLocation ? sourceLocation.path : undefined);
  const source = path && (location.sourcePath || sourceLocation?.kind === "file")
    ? state.documents.find(document => document.path === path) ?? null : null;
  const text = path && (location.sourcePath || sourceLocation?.kind === "text-file")
    ? state.textDocuments.find(document => document.path === path) ?? null : null;
  if (location.sourcePath && !source && !text && sourceLocation?.kind !== "document") {
    const sourcePath = location.sourcePath;
    return <div className="screen-stage" data-tool-source="pinned" data-tool-path={path}><FileViewerEmptyState title="Source unavailable" action={<Button variant="outline" size="sm" onClick={async () => {
      await actions.openPaths([sourcePath]);
      useMoleculeStore.getState().setActiveTab(tabId);
    }}>Reopen source</Button>} /></div>;
  }
  const documentId = source?.id ?? text?.id ?? null;
  const scoped = {
    ...state, activeTab: sourceTab, activeTabId: sourceTab?.id ?? null, activeDocument: source, activeDocumentId: source?.id ?? null,
    rightDockDocumentId: documentId, bottomDockDocumentId: documentId, rightDockTool: null, bottomDockTool: null,
    rightDockOpen: location.area === "right" ? isActive : state.rightDockOpen,
    bottomDockOpen: location.area === "bottom" ? isActive : state.bottomDockOpen,
    viewerLigandSelection: source ? state.viewerLigandSelections?.[source.id] ?? null : null,
    structureStory: source ? state.structureStories?.[source.id] ?? null : null,
    structureOverlayMode: source ? state.structureOverlayModes?.[source.id] ?? "single" as const : "single" as const,
  };
  return <div className="screen-stage" data-workspace-tool-drop={dropKind} data-tool-source={location.sourcePath ? "pinned" : "follow"} data-tool-path={path}><div className="dock-panel-body">
    <DockPanelContent area={location.area} activeTabKind={location.tool} state={scoped} actions={actions} dockDrops={drops ?? []} />
  </div></div>;
}
