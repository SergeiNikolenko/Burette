import {
  getMoleculeSessionSnapshot,
  useMoleculeStore,
  type MoleculeTab,
  type SessionTab,
} from "../stores/molecule-store";

export type { MoleculeTab, SessionTab } from "../stores/molecule-store";

export function useOpenTabs() {
  return useMoleculeStore((state) => state.tabs);
}

export function useOpenDocuments() {
  return useMoleculeStore((state) => state.documents);
}

export function useTabOrder() {
  return useMoleculeStore((state) => state.tabs.map((tab) => tab.id));
}

export function useTabCount() {
  return useMoleculeStore((state) => state.tabs.length);
}

export function useActiveTabId() {
  return useMoleculeStore((state) => state.activeTabId);
}

export function useActiveTab() {
  return useMoleculeStore(
    (state) => state.tabs.find((tab) => tab.id === state.activeTabId) ?? null,
  );
}

export function useActiveDocument() {
  return useMoleculeStore(
    (state) => state.documents.find((document) => document.id === state.activeDocumentId) ?? null,
  );
}

export function useAddTabs() {
  return useMoleculeStore((state) => state.addDocuments);
}

export function useOpenNewTab() {
  return useMoleculeStore((state) => state.openNewTab);
}

export function useOpenSettingsTab() {
  return useMoleculeStore((state) => state.openSettingsTab);
}

export function useCanNavigateBack() {
  return useMoleculeStore((state) => {
    const active = state.tabs.find((tab) => tab.id === state.activeTabId);
    return Boolean(active && active.back.length > 0);
  });
}

export function useCanNavigateForward() {
  return useMoleculeStore((state) => {
    const active = state.tabs.find((tab) => tab.id === state.activeTabId);
    return Boolean(active && active.forward.length > 0);
  });
}

export function useNavigateBack() {
  return useMoleculeStore((state) => state.navigateBack);
}

export function useNavigateForward() {
  return useMoleculeStore((state) => state.navigateForward);
}

export function useRecentStructures() {
  return useMoleculeStore((state) => state.recentStructures);
}

export function useRememberRecentStructures() {
  return useMoleculeStore((state) => state.rememberRecentStructures);
}

export function useClearRecentStructures() {
  return useMoleculeStore((state) => state.clearRecentStructures);
}

export function useSetActiveTab() {
  return useMoleculeStore((state) => state.setActiveTab);
}

export function useSetActiveDocument() {
  return useMoleculeStore((state) => state.setActiveDocument);
}

export function useCloseTab() {
  return useMoleculeStore((state) => state.closeTab);
}

export function useCloseDocument() {
  return useMoleculeStore((state) => state.closeDocument);
}

export function useCloseActiveTab() {
  return useMoleculeStore((state) => state.closeActiveDocument);
}

export function useCloseAllTabs() {
  return useMoleculeStore((state) => state.closeAllDocuments);
}

export function useRestoreSession() {
  return useMoleculeStore((state) => state.restoreSession);
}

export function getSessionSnapshot() {
  return getMoleculeSessionSnapshot(useMoleculeStore.getState());
}

export function restoreSession(tabs: SessionTab[], activeIndex: number | null) {
  useMoleculeStore.getState().restoreSession(tabs, activeIndex);
}

export function useIsActiveTab(id: string) {
  return useMoleculeStore((state) => state.activeTabId === id);
}

export function useIsActiveDocument(id: string) {
  return useMoleculeStore((state) => state.activeDocumentId === id);
}

export function isFileTab(tab: MoleculeTab) {
  return tab.location.kind === "file";
}
