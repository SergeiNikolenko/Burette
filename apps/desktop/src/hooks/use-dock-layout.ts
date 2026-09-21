import { useCallback, useMemo } from "react";
import { useMoleculeStore } from "../stores/molecule-store";
import { defaultTabWorkspace, useTabWorkspaceStore } from "../stores/tab-workspace-store";

export function useDockLayout(activeTabId: string | null) {
  const workspace = useTabWorkspaceStore((state) => activeTabId ? state.workspaces[activeTabId] : undefined);
  const fallback = useMemo(defaultTabWorkspace, []);
  const current = workspace ?? fallback;
  const toggleDockAction = useTabWorkspaceStore((state) => state.toggleDock);
  const setDockOpenAction = useTabWorkspaceStore((state) => state.setDockOpen);
  const setDockSizeAction = useTabWorkspaceStore((state) => state.setDockSize);
  const openDockTabAction = useTabWorkspaceStore((state) => state.openDockTab);
  const closeDockTabAction = useTabWorkspaceStore((state) => state.closeDockTab);
  const setDockActiveTabAction = useTabWorkspaceStore((state) => state.setDockActiveTab);
  const setDockDocumentAction = useTabWorkspaceStore((state) => state.setDockDocument);
  const setDockToolAction = useTabWorkspaceStore((state) => state.setDockTool);
  const addDockDropAction = useTabWorkspaceStore((state) => state.addDockDrop);
  const currentTabId = useCallback(() => useMoleculeStore.getState().activeTabId ?? activeTabId, [activeTabId]);
  const toggleDock = useCallback((area: Parameters<typeof toggleDockAction>[1]) => {
    const tabId = currentTabId();
    if (tabId) toggleDockAction(tabId, area);
  }, [currentTabId, toggleDockAction]);
  const setDockOpen = useCallback((area: Parameters<typeof setDockOpenAction>[1], open: boolean) => {
    const tabId = currentTabId();
    if (tabId) setDockOpenAction(tabId, area, open);
  }, [currentTabId, setDockOpenAction]);
  const setDockSize = useCallback((area: Parameters<typeof setDockSizeAction>[1], size: number) => {
    const tabId = currentTabId();
    if (tabId) setDockSizeAction(tabId, area, size);
  }, [currentTabId, setDockSizeAction]);
  const openDockTab = useCallback((area: Parameters<typeof openDockTabAction>[1], kind: Parameters<typeof openDockTabAction>[2]) => {
    const tabId = currentTabId();
    if (tabId) openDockTabAction(tabId, area, kind);
  }, [currentTabId, openDockTabAction]);
  const closeDockTab = useCallback((area: Parameters<typeof closeDockTabAction>[1], tabId: string) => {
    const workspaceTabId = currentTabId();
    if (workspaceTabId) closeDockTabAction(workspaceTabId, area, tabId);
  }, [closeDockTabAction, currentTabId]);
  const setDockActiveTab = useCallback((area: Parameters<typeof setDockActiveTabAction>[1], kind: Parameters<typeof setDockActiveTabAction>[2]) => {
    const tabId = currentTabId();
    if (tabId) setDockActiveTabAction(tabId, area, kind);
  }, [currentTabId, setDockActiveTabAction]);
  const setDockDocument = useCallback((area: Parameters<typeof setDockDocumentAction>[1], documentId: string | null) => {
    const tabId = currentTabId();
    if (tabId) setDockDocumentAction(tabId, area, documentId);
  }, [currentTabId, setDockDocumentAction]);
  const setDockTool = useCallback((area: Parameters<typeof setDockToolAction>[1], tool: Parameters<typeof setDockToolAction>[2]) => {
    const tabId = currentTabId();
    if (tabId) setDockToolAction(tabId, area, tool);
  }, [currentTabId, setDockToolAction]);
  const addDockDrop = useCallback((input: Parameters<typeof addDockDropAction>[1]) => {
    const tabId = currentTabId();
    if (tabId) addDockDropAction(tabId, input);
  }, [addDockDropAction, currentTabId]);

  return {
    rightDockOpen: current.right.open,
    rightDockWidth: current.right.size,
    rightDockTabs: current.right.tabs,
    rightDockActiveTab: current.right.activeTab,
    rightDockDocumentId: current.right.documentId,
    rightDockTool: current.right.tool,
    bottomDockOpen: current.bottom.open,
    bottomDockHeight: current.bottom.size,
    bottomDockTabs: current.bottom.tabs,
    bottomDockActiveTab: current.bottom.activeTab,
    bottomDockDocumentId: current.bottom.documentId,
    bottomDockTool: current.bottom.tool,
    dockDroppedStructures: current.droppedStructures,
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
