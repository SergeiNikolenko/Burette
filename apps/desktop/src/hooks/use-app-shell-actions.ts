import type { ShellActions } from "../components/types";
import type { DockDropInput } from "../lib/dock";
import type { MoleculeTab } from "../stores/molecule-store";
import type { ConformerJob, ViewerDocument, XtbJob } from "../types";

type SetState<T> = (value: T | ((previous: T) => T)) => void;
type PushStatus = (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;

export function createAppShellActions(actions: ShellActions): ShellActions {
  return actions;
}

export function createJobHistoryShellActions({
  pushStatus,
  setConformerJobs,
  setXtbJobs,
}: {
  pushStatus: PushStatus;
  setConformerJobs: SetState<ConformerJob[]>;
  setXtbJobs: SetState<XtbJob[]>;
}): Pick<ShellActions, "clearConformerJobs" | "clearXtbJobs"> {
  return {
    clearConformerJobs: () => {
      setConformerJobs([]);
      pushStatus("Job history cleared");
    },
    clearXtbJobs: () => {
      setXtbJobs([]);
      pushStatus("xTB job history cleared");
    },
  };
}

export function createProjectShellActions({
  pushStatus,
  removeProjectRoot,
  renameProjectRoot,
  togglePinnedProjectRoot,
}: {
  pushStatus: PushStatus;
  removeProjectRoot: (root: string) => void;
  renameProjectRoot: (root: string, name: string) => void;
  togglePinnedProjectRoot: (root: string) => void;
}): Pick<ShellActions, "togglePinnedProjectRoot" | "renameProjectRoot" | "removeProjectRoot"> {
  return {
    togglePinnedProjectRoot: (root: string) => {
      togglePinnedProjectRoot(root);
      pushStatus("Project pin updated");
    },
    renameProjectRoot: (root: string, name: string) => {
      renameProjectRoot(root, name);
      pushStatus(name.trim() ? "Project renamed" : "Project name reset");
    },
    removeProjectRoot: (root: string) => {
      removeProjectRoot(root);
      pushStatus("Project removed");
    },
  };
}

export function createDockDropShellActions({
  addDockDrop,
  pushStatus,
}: {
  addDockDrop: (input: DockDropInput) => void;
  pushStatus: PushStatus;
}): Pick<ShellActions, "addDockDrop"> {
  return {
    addDockDrop: (input) => {
      addDockDrop(input);
      const count = input.payload.paths.length + input.payload.records.length + (input.payload.items?.length ?? 0);
      const target = input.area === "right" ? "right dock" : "bottom dock";
      pushStatus(`Added ${count} item${count === 1 ? "" : "s"} to ${target}`);
    },
  };
}

export function createDocumentCloseShellActions({
  activeDocument,
  clearDirtyGridDocuments,
  closeActiveDocument,
  closeAllDocuments,
  closeDocument,
  closeGridRuntime,
  closeTab,
  confirmDiscardDirtyGridDocument,
  confirmDiscardDirtyGridDocuments,
  documents,
  forgetDirtyGridDocument,
  forgetDirtyGridDocuments,
  pushStatus,
  tabs,
}: {
  activeDocument: ViewerDocument | null;
  clearDirtyGridDocuments: () => void;
  closeActiveDocument: () => void;
  closeAllDocuments: () => void;
  closeDocument: (id: string) => void;
  closeGridRuntime: (documentId: string | null | undefined) => void;
  closeTab: (id: string) => void;
  confirmDiscardDirtyGridDocument: (documentId: string | null | undefined) => boolean;
  confirmDiscardDirtyGridDocuments: (documentIds: string[]) => boolean;
  documents: ViewerDocument[];
  forgetDirtyGridDocument: (documentId: string | null | undefined) => void;
  forgetDirtyGridDocuments: (documentIds: string[]) => void;
  pushStatus: PushStatus;
  tabs: MoleculeTab[];
}): Pick<ShellActions, "closeDocument" | "closeTab" | "closeActiveDocument" | "clearAllDocuments"> {
  return {
    closeDocument: (id: string) => {
      if (!confirmDiscardDirtyGridDocument(id)) return;
      closeGridRuntime(id);
      forgetDirtyGridDocument(id);
      closeDocument(id);
    },
    closeTab: (id: string) => {
      const tab = tabs.find((candidate) => candidate.id === id);
      const documentIds: string[] = [];
      if (tab?.location.kind === "file") {
        const location = tab.location;
        const document = documents.find((candidate) => (
          candidate.id === location.documentId ||
          candidate.path === location.path
        ));
        const targetDocumentId = document?.id ?? location.documentId ?? null;
        if (targetDocumentId) documentIds.push(targetDocumentId);
        if (!confirmDiscardDirtyGridDocuments(documentIds)) return;
        closeGridRuntime(targetDocumentId);
      }
      if (documentIds.length > 0) {
        forgetDirtyGridDocuments(documentIds);
      }
      closeTab(id);
    },
    closeActiveDocument: () => {
      if (!confirmDiscardDirtyGridDocument(activeDocument?.id)) return;
      closeGridRuntime(activeDocument?.id);
      forgetDirtyGridDocument(activeDocument?.id);
      closeActiveDocument();
      pushStatus("Closed active tab");
    },
    clearAllDocuments: () => {
      if (!confirmDiscardDirtyGridDocuments(documents.map((document) => document.id))) return;
      for (const document of documents) closeGridRuntime(document.id);
      clearDirtyGridDocuments();
      closeAllDocuments();
      pushStatus("Closed all tabs");
    },
  };
}

export function createRecentShellActions({
  clearRecentStructures,
  pushStatus,
}: {
  clearRecentStructures: () => void;
  pushStatus: PushStatus;
}): Pick<ShellActions, "clearRecentStructures"> {
  return {
    clearRecentStructures: () => {
      clearRecentStructures();
      pushStatus("Recent structures cleared");
    },
  };
}

export function createUpdateShellActions({
  checkForUpdates,
  installUpdate,
}: {
  checkForUpdates: (showStatus?: boolean) => Promise<void> | void;
  installUpdate: () => Promise<void> | void;
}): Pick<ShellActions, "checkForUpdates" | "installUpdate"> {
  return {
    checkForUpdates: async () => {
      await checkForUpdates(false);
    },
    installUpdate: async () => {
      await installUpdate();
    },
  };
}
