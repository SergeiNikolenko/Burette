import type { ShellActions } from "../components/types";
import { useMoleculeStore } from "../stores/molecule-store";
import type { ViewerDocument } from "../types";

let opening = Promise.resolve();

export function openSidebarFile(
  path: string,
  permanent: boolean,
  getActions: () => Pick<ShellActions, "openPaths" | "closeTab" | "selectTab">,
  isDirty: (document: ViewerDocument) => boolean,
  canCloseTab: (id: string) => boolean,
) {
  const pane = useMoleculeStore.getState().tabs.find(tab => tab.id === useMoleculeStore.getState().activeTabId)?.pane ?? null;
  const request = opening.then(async () => {
    const store = useMoleculeStore;
    const existing = store.getState().tabs.find(tab => "path" in tab.location && tab.location.path === path);
    if (existing) {
      getActions().selectTab(existing.id);
      if (permanent) store.getState().promotePreviewTab(existing.id);
      return;
    }
    const before = new Set(store.getState().tabs.map(tab => tab.id));
    await getActions().openPaths([path]);
    const opened = store.getState().tabs.find(tab => !before.has(tab.id) && "path" in tab.location && tab.location.path === path);
    if (!opened) return;
    store.getState().placeTab(opened.id, pane);
    if (permanent) return;
    const previous = store.getState().tabs.find(tab => tab.id !== opened.id && tab.preview && (tab.pane ?? null) === pane);
    if (previous) {
      const location = previous.location;
      const document = location.kind === "file" ? store.getState().documents.find(doc => doc.id === location.documentId || doc.path === location.path) : undefined;
      if (!canCloseTab(previous.id) || (document && (document.sceneUnsaved || isDirty(document)))) store.getState().promotePreviewTab(previous.id);
      else await getActions().closeTab(previous.id);
    }
    // A cancelled close stays permanent; never discard its edits or leave two
    // temporary tabs in the same pane. Guarded close owns runtime cleanup.
    store.getState().markPreviewTab(opened.id);
    store.getState().setActiveTab(opened.id);
  });
  opening = request.catch(() => {});
  return request;
}
