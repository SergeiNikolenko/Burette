import { useCallback, useEffect, useMemo } from "react";
import type { AppPage, ShellTab } from "../components/types";
import {
  createLauncherTab,
  createSettingsTab,
  useEditorStore,
} from "../stores/editor-store";
import type { ViewerDocument } from "../types";

type UtilityTab = Extract<ShellTab, { kind: "launcher" | "settings" }>;

function appendNavigationEntry(stack: string[], id: string) {
  return [...stack.filter((candidate) => candidate !== id), id].slice(-100);
}

function lastNavigableIndex(stack: string[], validIds: Set<string>, activeId: string | null) {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const id = stack[index];
    if (id !== activeId && validIds.has(id)) return index;
  }
  return -1;
}

type UseTabsOptions = {
  documents: ViewerDocument[];
  activeDocumentId: string | null;
  setActiveDocument: (id: string) => void;
  closeDocument: (id: string) => void;
  closeActiveDocument: () => void;
  closeAllDocuments: () => void;
  closeWorkspace: () => void;
};

export function useTabs({
  documents,
  activeDocumentId,
  setActiveDocument,
  closeDocument,
  closeActiveDocument,
  closeAllDocuments,
  closeWorkspace,
}: UseTabsOptions) {
  const page = useEditorStore((state) => state.page);
  const utilityTabs = useEditorStore((state) => state.utilityTabs);
  const activeUtilityTabId = useEditorStore((state) => state.activeUtilityTabId);
  const navigationBack = useEditorStore((state) => state.navigationBack);
  const navigationForward = useEditorStore((state) => state.navigationForward);
  const documentLoadStates = useEditorStore((state) => state.documentLoadStates);
  const setPage = useEditorStore((state) => state.setPage);
  const setUtilityTabs = useEditorStore((state) => state.setUtilityTabs);
  const setActiveUtilityTabId = useEditorStore((state) => state.setActiveUtilityTabId);
  const setNavigationBack = useEditorStore((state) => state.setNavigationBack);
  const setNavigationForward = useEditorStore((state) => state.setNavigationForward);
  const resetNavigation = useEditorStore((state) => state.resetNavigation);

  const documentIds = useMemo(() => new Set(documents.map((document) => document.id)), [documents]);
  const tabs = useMemo<ShellTab[]>(
    () => [
      ...documents.map((document) => ({
        id: document.id,
        kind: "document" as const,
        document,
        title: document.title,
        loadState: documentLoadStates[document.id] ?? "loading",
      })),
      ...utilityTabs,
    ],
    [documentLoadStates, documents, utilityTabs],
  );
  const tabIds = useMemo(() => new Set(tabs.map((tab) => tab.id)), [tabs]);
  const activeTabId = page === "viewer" ? activeDocumentId : activeUtilityTabId;
  const canNavigateBack = lastNavigableIndex(navigationBack, documentIds, activeDocumentId) !== -1;
  const canNavigateForward = lastNavigableIndex(navigationForward, documentIds, activeDocumentId) !== -1;

  useEffect(() => {
    if (documents.length > 0 || utilityTabs.length > 0) return;
    const launcherTab = createLauncherTab();
    setUtilityTabs([launcherTab]);
    setActiveUtilityTabId(launcherTab.id);
    setPage("launcher");
  }, [documents.length, utilityTabs.length]);

  const selectDocument = useCallback((id: string) => {
    if (!documentIds.has(id)) return;
    if (id !== activeDocumentId && activeDocumentId && documentIds.has(activeDocumentId)) {
      setNavigationBack((stack) => appendNavigationEntry(stack, activeDocumentId));
      setNavigationForward([]);
    }
    setActiveDocument(id);
    setActiveUtilityTabId(null);
    setPage("viewer");
  }, [activeDocumentId, documentIds, setActiveDocument]);

  const selectTab = useCallback((id: string) => {
    if (documentIds.has(id)) {
      selectDocument(id);
      return;
    }
    const utilityTab = utilityTabs.find((tab) => tab.id === id);
    if (!utilityTab) return;
    setActiveUtilityTabId(id);
    setPage(utilityTab.kind);
  }, [documentIds, selectDocument, utilityTabs]);

  const navigateBack = useCallback(() => {
    const index = lastNavigableIndex(navigationBack, documentIds, activeDocumentId);
    if (index === -1) return;
    const targetId = navigationBack[index];
    setNavigationBack(navigationBack.slice(0, index));
    if (activeDocumentId && documentIds.has(activeDocumentId)) {
      setNavigationForward((stack) => appendNavigationEntry(stack, activeDocumentId));
    }
    setActiveDocument(targetId);
    setActiveUtilityTabId(null);
    setPage("viewer");
  }, [activeDocumentId, documentIds, navigationBack, setActiveDocument]);

  const navigateForward = useCallback(() => {
    const index = lastNavigableIndex(navigationForward, documentIds, activeDocumentId);
    if (index === -1) return;
    const targetId = navigationForward[index];
    setNavigationForward(navigationForward.slice(0, index));
    if (activeDocumentId && documentIds.has(activeDocumentId)) {
      setNavigationBack((stack) => appendNavigationEntry(stack, activeDocumentId));
    }
    setActiveDocument(targetId);
    setActiveUtilityTabId(null);
    setPage("viewer");
  }, [activeDocumentId, documentIds, navigationForward, setActiveDocument]);

  const cycleDocument = useCallback((direction: 1 | -1) => {
    if (tabs.length < 2 || !activeTabId) return;
    const currentIndex = Math.max(0, tabs.findIndex((tab) => tab.id === activeTabId));
    const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
    selectTab(tabs[nextIndex].id);
  }, [activeTabId, selectTab, tabs]);

  const closeUtilityTab = useCallback((id: string) => {
    setUtilityTabs((currentTabs) => {
      const index = currentTabs.findIndex((tab) => tab.id === id);
      if (index === -1) return currentTabs;
      const nextTabs = currentTabs.filter((tab) => tab.id !== id);
      if (activeUtilityTabId !== id) return nextTabs;

      const replacement = nextTabs[index] ?? nextTabs[index - 1] ?? null;
      if (replacement) {
        setActiveUtilityTabId(replacement.id);
        setPage(replacement.kind);
        return nextTabs;
      }

      if (documents.length > 0 && activeDocumentId) {
        setActiveUtilityTabId(null);
        setPage("viewer");
        return nextTabs;
      }

      const launcherTab = createLauncherTab();
      setActiveUtilityTabId(launcherTab.id);
      setPage("launcher");
      return [launcherTab];
    });
  }, [activeDocumentId, activeUtilityTabId, documents.length]);

  const closeDocumentWithHistory = useCallback((id: string) => {
    closeDocument(id);
    setNavigationBack((stack) => stack.filter((candidate) => candidate !== id));
    setNavigationForward((stack) => stack.filter((candidate) => candidate !== id));
  }, [closeDocument]);

  const closeTab = useCallback((id: string) => {
    if (documentIds.has(id)) {
      closeDocumentWithHistory(id);
      return;
    }
    closeUtilityTab(id);
  }, [closeDocumentWithHistory, closeUtilityTab, documentIds]);

  const closeActiveDocumentWithHistory = useCallback(() => {
    if (activeDocumentId) {
      setNavigationBack((stack) => stack.filter((candidate) => candidate !== activeDocumentId));
      setNavigationForward((stack) => stack.filter((candidate) => candidate !== activeDocumentId));
    }
    closeActiveDocument();
  }, [activeDocumentId, closeActiveDocument]);

  const closeAllDocumentsWithHistory = useCallback(() => {
    resetNavigation();
    closeAllDocuments();
  }, [closeAllDocuments, resetNavigation]);

  const closeAllTabs = useCallback(() => {
    const launcherTab = createLauncherTab();
    resetNavigation();
    closeAllDocuments();
    setUtilityTabs([launcherTab]);
    setActiveUtilityTabId(launcherTab.id);
    setPage("launcher");
  }, [closeAllDocuments, resetNavigation, setActiveUtilityTabId, setPage, setUtilityTabs]);

  const closeWorkspaceWithHistory = useCallback(() => {
    const launcherTab = createLauncherTab();
    resetNavigation();
    closeWorkspace();
    setUtilityTabs([launcherTab]);
    setActiveUtilityTabId(launcherTab.id);
    setPage("launcher");
  }, [closeWorkspace, resetNavigation, setActiveUtilityTabId, setPage, setUtilityTabs]);

  const activateOpenedDocuments = useCallback((nextActiveId: string | null) => {
    if (nextActiveId && activeDocumentId && activeDocumentId !== nextActiveId && documentIds.has(activeDocumentId)) {
      setNavigationBack((stack) => appendNavigationEntry(stack, activeDocumentId));
      setNavigationForward([]);
    }
    if (nextActiveId && page === "launcher" && activeUtilityTabId) {
      setUtilityTabs((currentTabs) => currentTabs.filter((tab) => tab.id !== activeUtilityTabId));
      setActiveUtilityTabId(null);
    }
    setPage("viewer");
  }, [activeDocumentId, activeUtilityTabId, documentIds, page]);

  const activateNewTabDocuments = useCallback((nextActiveId: string | null) => {
    if (nextActiveId && activeDocumentId && documentIds.has(activeDocumentId)) {
      setNavigationBack((stack) => appendNavigationEntry(stack, activeDocumentId));
      setNavigationForward([]);
    }
    setActiveUtilityTabId(null);
    setPage("viewer");
  }, [activeDocumentId, documentIds]);

  const openLauncher = useCallback(() => {
    const launcherTab = createLauncherTab();
    setUtilityTabs((currentTabs) => [...currentTabs, launcherTab]);
    setActiveUtilityTabId(launcherTab.id);
    setPage("launcher");
  }, []);

  const openSettings = useCallback(() => {
    const settingsTab = createSettingsTab();
    setUtilityTabs((currentTabs) => {
      if (currentTabs.some((tab) => tab.id === settingsTab.id)) return currentTabs;
      if (page === "launcher" && activeUtilityTabId) {
        return currentTabs.map((tab) => (tab.id === activeUtilityTabId ? settingsTab : tab));
      }
      return [...currentTabs, settingsTab];
    });
    setActiveUtilityTabId(settingsTab.id);
    setPage("settings");
  }, [activeUtilityTabId, page]);

  return {
    page,
    tabs,
    activeTabId,
    tabIds,
    canNavigateBack,
    canNavigateForward,
    selectDocument,
    selectTab,
    cycleDocument,
    navigateBack,
    navigateForward,
    closeTab,
    closeDocumentWithHistory,
    closeActiveDocumentWithHistory,
    closeAllDocumentsWithHistory,
    closeAllTabs,
    closeWorkspaceWithHistory,
    activateOpenedDocuments,
    activateNewTabDocuments,
    openLauncher,
    openSettings,
  };
}
