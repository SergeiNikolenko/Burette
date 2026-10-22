import { useCallback, useMemo, useLayoutEffect } from "react";
import { useMoleculeStore } from "../stores/molecule-store";
import { defaultTabWorkspace, useTabWorkspaceStore, WINDOW_TOOLS_ID } from "../stores/tab-workspace-store";

export function useDockLayout(activeTabId: string | null) {
  const workspace = useTabWorkspaceStore((state) => activeTabId ? state.workspaces[activeTabId] : undefined);
  const fallback = useMemo(defaultTabWorkspace, []);
  const current = workspace ?? fallback;
  const windowTools = useTabWorkspaceStore(state => state.workspaces[WINDOW_TOOLS_ID]);
  useLayoutEffect(() => { useTabWorkspaceStore.getState().ensureWindowTools(activeTabId); }, [activeTabId]);
  const bottom = windowTools?.bottom ?? current.bottom;
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
  const currentTabId = useCallback((area: "right" | "bottom") => area === "bottom" ? WINDOW_TOOLS_ID : useMoleculeStore.getState().activeTabId ?? activeTabId, [activeTabId]);
  // Capture the originating panel before file preparation starts; the general
  // shell actions still resolve the current tab after synchronous navigation.
  // The bottom dock belongs to the window-wide tools workspace.
  const captureDockTarget = useCallback(() => {
    const targetTabId = (area: "right" | "bottom") => area === "bottom" ? WINDOW_TOOLS_ID : activeTabId;
    return {
      setDockDocument: (area: Parameters<typeof setDockDocumentAction>[1], id: string | null) => { const tabId = targetTabId(area); if (tabId) setDockDocumentAction(tabId, area, id); },
      setDockTool: (area: Parameters<typeof setDockToolAction>[1], tool: Parameters<typeof setDockToolAction>[2]) => { const tabId = targetTabId(area); if (tabId) setDockToolAction(tabId, area, tool); },
      addDockDrop: (input: Parameters<typeof addDockDropAction>[1]) => { const tabId = targetTabId(input.area); if (tabId) addDockDropAction(tabId, input); },
    };
  }, [activeTabId, setDockDocumentAction, setDockToolAction, addDockDropAction]);
  const toggleDock = useCallback((area: Parameters<typeof toggleDockAction>[1]) => {
    const tabId = currentTabId(area);
    if (tabId) toggleDockAction(tabId, area);
  }, [currentTabId, toggleDockAction]);
  const setDockOpen = useCallback((area: Parameters<typeof setDockOpenAction>[1], open: boolean) => {
    const tabId = currentTabId(area);
    if (tabId) setDockOpenAction(tabId, area, open);
  }, [currentTabId, setDockOpenAction]);
  const setDockSize = useCallback((area: Parameters<typeof setDockSizeAction>[1], size: number) => {
    const tabId = currentTabId(area);
    if (tabId) setDockSizeAction(tabId, area, size);
  }, [currentTabId, setDockSizeAction]);
  const openDockTab = useCallback((area: Parameters<typeof openDockTabAction>[1], kind: Parameters<typeof openDockTabAction>[2]) => {
    const tabId = currentTabId(area);
    if (tabId) openDockTabAction(tabId, area, kind);
  }, [currentTabId, openDockTabAction]);
  const closeDockTab = useCallback((area: Parameters<typeof closeDockTabAction>[1], tabId: string) => {
    const workspaceTabId = currentTabId(area);
    if (workspaceTabId) closeDockTabAction(workspaceTabId, area, tabId);
  }, [closeDockTabAction, currentTabId]);
  const setDockActiveTab = useCallback((area: Parameters<typeof setDockActiveTabAction>[1], kind: Parameters<typeof setDockActiveTabAction>[2]) => {
    const tabId = currentTabId(area);
    if (tabId) setDockActiveTabAction(tabId, area, kind);
  }, [currentTabId, setDockActiveTabAction]);
  const setDockDocument = useCallback((area: Parameters<typeof setDockDocumentAction>[1], documentId: string | null) => {
    const tabId = currentTabId(area);
    if (tabId) setDockDocumentAction(tabId, area, documentId);
  }, [currentTabId, setDockDocumentAction]);
  const setDockTool = useCallback((area: Parameters<typeof setDockToolAction>[1], tool: Parameters<typeof setDockToolAction>[2]) => {
    const tabId = currentTabId(area);
    if (tabId) setDockToolAction(tabId, area, tool);
  }, [currentTabId, setDockToolAction]);
  const addDockDrop = useCallback((input: Parameters<typeof addDockDropAction>[1]) => {
    const tabId = currentTabId(input.area);
    if (tabId) addDockDropAction(tabId, input);
  }, [addDockDropAction, currentTabId]);

  return {
    captureDockTarget,
    rightDockOpen: current.right.open,
    rightDockWidth: current.right.size,
    rightDockTabs: current.right.tabs,
    rightDockActiveTab: current.right.activeTab,
    rightDockDocumentId: boundDocument(current.right),
    rightDockTool: current.right.tool,
    bottomDockOpen: bottom.open,
    bottomDockHeight: bottom.size,
    bottomDockTabs: bottom.tabs,
    bottomDockActiveTab: bottom.activeTab,
    bottomDockDocumentId: boundDocument(bottom),
    bottomDockTool: bottom.tool,
    dockDroppedStructures: [...current.droppedStructures.filter(drop => drop.area === "right"), ...(windowTools ?? current).droppedStructures.filter(drop => drop.area === "bottom")],
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
