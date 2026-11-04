import { useCallback, useEffect, useLayoutEffect, useMemo } from "react";
import { toggleWorkspacePanel } from "../lib/workspace-panel-toggle";
import { retainDockCameraWorkspaces } from "../lib/dock-camera-transfer";
import { dockTabCatalog, firstDockTabKind, type DockTabKind } from "../lib/dock";
import { migrateLegacyRightPanels, openRightDockDrop, openRightDocument, openRightLocation, openRightTool, rightDocumentLocation, rightPanelSelection, setRightPanelOpen } from "../lib/right-workspace-panel";
import { useMoleculeStore } from "../stores/molecule-store";
import { defaultTabWorkspace, useTabWorkspaceStore, WINDOW_TOOLS_ID } from "../stores/tab-workspace-store";
import { useWorkspacePanesStore } from "../stores/workspace-panes-store";

export function useDockLayout(activeTabId: string | null) {
  useEffect(() => {
    const retain = () => retainDockCameraWorkspaces(useMoleculeStore.getState().tabs.map(tab => tab.id));
    retain();
    return useMoleculeStore.subscribe((state, previous) => { if (state.tabs !== previous.tabs) retain(); });
  }, []);
  const workspace = useTabWorkspaceStore((state) => activeTabId ? state.workspaces[activeTabId] : undefined);
  const fallback = useMemo(defaultTabWorkspace, []);
  const current = workspace ?? fallback;
  const windowTools = useTabWorkspaceStore(state => state.workspaces[WINDOW_TOOLS_ID]);
  useLayoutEffect(() => { useTabWorkspaceStore.getState().ensureWindowTools(activeTabId); }, [activeTabId]);
  useLayoutEffect(migrateLegacyRightPanels, []);
  const bottom = windowTools?.bottom ?? current.bottom;
  const rightSelectedId = useWorkspacePanesStore(state => state.selectedTabs.right);
  const rightClosed = useWorkspacePanesStore(state => state.closedGroups.right === true);
  const rightRatio = useWorkspacePanesStore(state => state.split.right);
  const tabs = useMoleculeStore(state => state.tabs);
  const right = rightPanelSelection(tabs, activeTabId, rightSelectedId);
  const rightLocation = right?.location;
  const rightDrops = useTabWorkspaceStore(state => right ? state.workspaces[right.id]?.droppedStructures : undefined);
  const documents = useMoleculeStore(state => state.documents);
  const textDocuments = useMoleculeStore(state => state.textDocuments);
  const boundDocument = (dock: typeof current.right) => dock.documentPath
    ? [...documents, ...textDocuments].find(document => document.path === dock.documentPath)?.id ?? `missing:${dock.documentPath}`
    : dock.documentId;
  const toggleDockAction = useTabWorkspaceStore((state) => state.toggleDock);
  const setDockOpenAction = useTabWorkspaceStore((state) => state.setDockOpen);
  const setDockSizeAction = useTabWorkspaceStore((state) => state.setDockSize);
  const openDockTabAction = useTabWorkspaceStore((state) => state.openDockTab);
  const closeDockTabAction = useTabWorkspaceStore((state) => state.closeDockTab);
  const setDockActiveTabAction = useTabWorkspaceStore((state) => state.setDockActiveTab);
  const setDockDocumentAction = useTabWorkspaceStore((state) => state.setDockDocument);
  const setDockToolAction = useTabWorkspaceStore((state) => state.setDockTool);
  const addDockDropAction = useTabWorkspaceStore((state) => state.addDockDrop);
  const openContextTool = useCallback((kind: DockTabKind) => {
    if (!dockTabCatalog("right").includes(kind)) return;
    const model = useMoleculeStore.getState();
    const source = model.tabs.find(tab => tab.id === model.activeTabId);
    // Opening a tool from the main group follows that group. A viewer in a
    // secondary pane can instead request a tool tied to its own source.
    const location = source?.location;
    const path = source?.pane && location && "path" in location ? location.path
      : location?.kind === "tool" ? location.sourcePath : undefined;
    openRightTool(kind, kind === "files" ? undefined : path);
  }, []);
  // Bind asynchronous operations to their originating workspace. When the user
  // has selected another tab before the load finishes, add the result without
  // changing selection.
  const captureDockTarget = useCallback(() => {
    const workspaceId = activeTabId;
    const alive = () => Boolean(workspaceId) && useMoleculeStore.getState().tabs.some(tab => tab.id === workspaceId);
    const focused = () => useMoleculeStore.getState().activeTabId === workspaceId;
    let rightInputTabId: string | undefined;
    return {
      workspaceId,
      setDockDocument: (area: Parameters<typeof setDockDocumentAction>[1], id: string | null) => {
        if (area === "bottom") setDockDocumentAction(WINDOW_TOOLS_ID, area, id);
        else if (id && alive()) openRightDocument(id, focused());
      },
      setDockTool: (area: Parameters<typeof setDockToolAction>[1], tool: Parameters<typeof setDockToolAction>[2]) => {
        if (area === "bottom") setDockToolAction(WINDOW_TOOLS_ID, area, tool);
        else if (tool && alive()) openRightLocation({ kind: tool }, focused());
      },
      openRightInputs: (ids: string[], kind: DockTabKind) => {
        if (!alive()) return;
        const focus = focused();
        for (const id of new Set(ids)) {
          const location = rightDocumentLocation(id);
          if (!location) continue;
          const tool = kind !== "files" && "path" in location
            ? { kind: "tool", tool: kind, area: "right", sourcePath: location.path } as const
            : location;
          const tabId = openRightLocation(tool, focus && !rightInputTabId);
          rightInputTabId ??= tabId;
        }
      },
      addDockDrop: (input: Parameters<typeof addDockDropAction>[1]) => {
        if (input.area === "bottom") addDockDropAction(WINDOW_TOOLS_ID, input);
        else if (rightInputTabId && input.tabKind !== "files") addDockDropAction(rightInputTabId, input);
        else if (alive()) openRightDockDrop(input, focused());
      },
    };
  }, [activeTabId, setDockDocumentAction, setDockToolAction, addDockDropAction]);
  const toggleDock = useCallback((area: Parameters<typeof toggleDockAction>[1]) => {
    if (toggleWorkspacePanel(area)) return;
    toggleDockAction(WINDOW_TOOLS_ID, area);
  }, [toggleDockAction]);
  const setDockOpen = useCallback((area: Parameters<typeof setDockOpenAction>[1], open: boolean) => {
    if (area === "right") setRightPanelOpen(open);
    else setDockOpenAction(WINDOW_TOOLS_ID, area, open);
  }, [setDockOpenAction]);
  const setDockSize = useCallback((area: Parameters<typeof setDockSizeAction>[1], size: number) => {
    if (area === "bottom") setDockSizeAction(WINDOW_TOOLS_ID, area, size);
    else {
      const width = document.querySelector(".page-stack")?.clientWidth ?? window.innerWidth;
      if (width > 0) useWorkspacePanesStore.getState().setSplit("right", 1 - size / width);
    }
  }, [setDockSizeAction]);
  const openDockTab = useCallback((area: Parameters<typeof openDockTabAction>[1], kind: Parameters<typeof openDockTabAction>[2]) => {
    if (area === "right") openContextTool(kind);
    else openDockTabAction(WINDOW_TOOLS_ID, area, kind);
  }, [openContextTool, openDockTabAction]);
  const closeDockTab = useCallback((area: Parameters<typeof closeDockTabAction>[1], tabId: string) => {
    if (area === "right") useMoleculeStore.getState().closeTab(tabId);
    else closeDockTabAction(WINDOW_TOOLS_ID, area, tabId);
  }, [closeDockTabAction]);
  const setDockActiveTab = useCallback((area: Parameters<typeof setDockActiveTabAction>[1], kind: Parameters<typeof setDockActiveTabAction>[2]) => {
    if (area === "right") openContextTool(kind);
    else setDockActiveTabAction(WINDOW_TOOLS_ID, area, kind);
  }, [openContextTool, setDockActiveTabAction]);
  const setDockDocument = useCallback((area: Parameters<typeof setDockDocumentAction>[1], documentId: string | null) => {
    if (area === "bottom") setDockDocumentAction(WINDOW_TOOLS_ID, area, documentId);
    else if (documentId) openRightDocument(documentId);
    else openRightTool("files");
  }, [setDockDocumentAction]);
  const setDockTool = useCallback((area: Parameters<typeof setDockToolAction>[1], tool: Parameters<typeof setDockToolAction>[2]) => {
    if (area === "bottom") setDockToolAction(WINDOW_TOOLS_ID, area, tool);
    else if (tool) openRightLocation({ kind: tool });
    else openRightTool("files");
  }, [setDockToolAction]);
  const addDockDrop = useCallback((input: Parameters<typeof addDockDropAction>[1]) => {
    if (input.area === "right") openRightDockDrop(input);
    else addDockDropAction(WINDOW_TOOLS_ID, input);
  }, [addDockDropAction]);

  const rightKind = (location?: typeof rightLocation) => location?.kind === "tool" ? location.tool : "files";
  const sourcePath = rightLocation?.kind === "tool" ? rightLocation.sourcePath : rightLocation && "path" in rightLocation ? rightLocation.path : undefined;
  const sourceDocuments = rightLocation?.kind === "file" ? documents : rightLocation?.kind === "text-file" ? textDocuments : [...documents, ...textDocuments];
  return {
    captureDockTarget,
    rightDockOpen: Boolean(right && !rightClosed),
    rightDockWidth: Math.round((1 - rightRatio) * window.innerWidth),
    rightDockTabs: tabs.filter(tab => tab.pane === "right").map(tab => ({ id: tab.id, kind: rightKind(tab.location) })),
    rightDockActiveTab: rightLocation ? rightKind(rightLocation) : firstDockTabKind("right"),
    rightDockDocumentId: sourcePath ? sourceDocuments.find(document => document.path === sourcePath)?.id ?? `missing:${sourcePath}` : null,
    rightDockTool: rightLocation?.kind === "ketcher" ? "ketcher" as const : null,
    bottomDockOpen: bottom.open,
    bottomDockHeight: bottom.size,
    bottomDockTabs: bottom.tabs,
    bottomDockActiveTab: bottom.activeTab,
    bottomDockDocumentId: boundDocument(bottom),
    bottomDockTool: bottom.tool,
    dockDroppedStructures: [...(rightDrops ?? []), ...(windowTools ?? current).droppedStructures.filter(drop => drop.area === "bottom")],
    toggleDock,
    setDockOpen,
    setDockSize,
    openDockTab,
    closeDockTab,
    setDockActiveTab,
    setDockDocument,
    setDockTool,
    addDockDrop,
  };
}
