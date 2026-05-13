import { useEditorStore } from "../stores/editor-store";
import { useAppStore } from "../store";

export function getOpenDocuments() {
  return useAppStore.getState().documents;
}

export function getOpenDocumentByPath(path: string) {
  return useAppStore.getState().documents.find((document) => document.path === path) ?? null;
}

export function getActiveDocumentId() {
  return useAppStore.getState().activeDocumentId;
}

export function getOpenTabs() {
  const { documents } = useAppStore.getState();
  const { utilityTabs } = useEditorStore.getState();
  return [...documents, ...utilityTabs];
}

export function getActiveTabId() {
  const { activeDocumentId } = useAppStore.getState();
  const { page, activeUtilityTabId } = useEditorStore.getState();
  return page === "viewer" ? activeDocumentId : activeUtilityTabId;
}

export function closeDocument(id: string) {
  useAppStore.getState().closeDocument(id);
}

export function closeActiveDocument() {
  useAppStore.getState().closeActiveDocument();
}
