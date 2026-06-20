import { useMemo } from "react";
import type { ShellActions } from "../components/types";
import type { DockDropInput } from "../lib/dock";
import type { MoleculeTab } from "../stores/molecule-store";
import type { ConformerJob, OpenDocumentsMode, ViewerDocument, ViewerPreferences, ViewerReloadOptions, XtbJob } from "../types";

type SetState<T> = (value: T | ((previous: T) => T)) => void;
type PushStatus = (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;
type PushErrorStatus = (error: unknown, prefix?: string, details?: string[]) => void;

type UseAppShellActionsOptions = {
  activeDocument: ViewerDocument | null;
  addDockDrop: ShellActions["addDockDrop"];
  addXyzrenderSheetItemsToDocument: ShellActions["addXyzrenderSheetItems"];
  appendGridRecords: ShellActions["appendGridRecords"];
  applyGridDescriptorControls: ShellActions["applyGridDescriptorControls"];
  applyGridDescriptorResults: ShellActions["applyGridDescriptorResults"];
  applyKetcherToGridRow: ShellActions["applyKetcherToGridRow"];
  backToApp: ShellActions["backToApp"];
  calculateGridDescriptors: ShellActions["calculateGridDescriptors"];
  canNavigateBack: boolean;
  canNavigateForward: boolean;
  cancelConformerJob: ShellActions["cancelConformerJob"];
  cancelXtbJob: ShellActions["cancelXtbJob"];
  checkConformerStatus: ShellActions["checkConformerStatus"];
  checkForUpdates: (showStatus?: boolean) => Promise<void> | void;
  checkXtbStatus: ShellActions["checkXtbStatus"];
  chooseFiles: ShellActions["chooseFiles"];
  chooseWorkspace: ShellActions["chooseWorkspace"];
  clearCache: ShellActions["clearCache"];
  clearDescriptorSource: ShellActions["clearDescriptorSource"];
  clearDirtyGridDocuments: () => void;
  clearKetcherImportRequest: ShellActions["clearKetcherImportRequest"];
  clearRecentStructures: () => void;
  closeActiveDocument: () => void;
  closeAllDocuments: () => void;
  closeDocument: (id: string) => void;
  closeDockTab: ShellActions["closeDockTab"];
  closeGridRuntime: (documentId: string | null | undefined) => void;
  closeQuickLookPreview: ShellActions["closeQuickLookPreview"];
  closeTab: (id: string) => void;
  confirmDiscardDirtyGridDocument: (documentId: string | null | undefined) => boolean;
  confirmDiscardDirtyGridDocuments: (documentIds: string[]) => boolean;
  copyActiveDocumentPath: ShellActions["copyActiveDocumentPath"];
  copyDocumentPath: ShellActions["copyDocumentPath"];
  copyPath: ShellActions["copyPath"];
  documents: ViewerDocument[];
  exportActivePreviewAsPng: ShellActions["exportActivePreviewAsPng"];
  exportActivePreviewAsSvg: ShellActions["exportActivePreviewAsSvg"];
  exportDiagnostics: ShellActions["exportDiagnostics"];
  focusSidebarSearch: ShellActions["focusSidebarSearch"];
  forgetDirtyGridDocument: (documentId: string | null | undefined) => void;
  forgetDirtyGridDocuments: (documentIds: string[]) => void;
  generate3DConformer: ShellActions["generate3DConformer"];
  installUpdate: () => Promise<void> | void;
  installXtb: ShellActions["installXtb"];
  listChemicalEditorTargets: ShellActions["listChemicalEditorTargets"];
  mergeMoleculeCollections: ShellActions["mergeMoleculeCollections"];
  moveTab: ShellActions["moveTab"];
  navigateBack: ShellActions["navigateBack"];
  navigateForward: ShellActions["navigateForward"];
  openClipboard: ShellActions["openClipboard"];
  openCommandPalette: ShellActions["openCommandPalette"];
  openDescriptorSource: ShellActions["openDescriptorSource"];
  openDockPayload: ShellActions["openDockPayload"];
  openDockTab: ShellActions["openDockTab"];
  openDockingDocument: ShellActions["openDockingDocument"];
  openDockingStructureRecords: ShellActions["openDockingStructureRecords"];
  openDocuments: (
    paths: string[],
    reloadOptions?: ViewerReloadOptions,
    preferences?: Partial<ViewerPreferences>,
    options?: { replace?: boolean; inActiveTab?: boolean; mode?: OpenDocumentsMode },
  ) => void | Promise<unknown>;
  openFepNetworkPreview: ShellActions["openFepNetworkPreview"];
  openFepSetupWorkspace: ShellActions["openFepSetupWorkspace"];
  openKetcher: ShellActions["openKetcher"];
  openKetcherExportRaw: ShellActions["openKetcherExportRaw"];
  openKetcherSketch: ShellActions["openKetcherSketch"];
  openKetcherWithStructures: ShellActions["openKetcherWithStructures"];
  openLogs: ShellActions["openLogs"];
  openMostRecentStructure: ShellActions["openMostRecentStructure"];
  openNewTab: ShellActions["openNewTab"];
  openNewWindow: ShellActions["openNewWindow"];
  openPathInChemicalEditor: ShellActions["openPathInChemicalEditor"];
  openPathWithDefaultApp: ShellActions["openPathWithDefaultApp"];
  openPaths: ShellActions["openPaths"];
  openProjectFolder: ShellActions["openProjectFolder"];
  openRecentStructure: ShellActions["openRecentStructure"];
  openSettings: ShellActions["openSettings"];
  openSettingsSection: ShellActions["openSettingsSection"];
  openStructureRecords: ShellActions["openStructureRecords"];
  openTextDocuments: (paths: string[]) => void | Promise<unknown>;
  openUpdateRelease: ShellActions["openUpdateRelease"];
  openWorkspaceFolder: ShellActions["openWorkspaceFolder"];
  pushErrorStatus: PushErrorStatus;
  pushStatus: PushStatus;
  reloadXyzrenderDocument: ShellActions["reloadXyzrenderDocument"];
  removeProjectRoot: (root: string) => void;
  renameProjectRoot: (root: string, name: string) => void;
  resetQuickLook: ShellActions["resetQuickLook"];
  revealActiveDocument: ShellActions["revealActiveDocument"];
  revealDocument: ShellActions["revealDocument"];
  revealPath: ShellActions["revealPath"];
  runConformerOperation: ShellActions["runConformerOperation"];
  runExternalRuntimeDoctor: ShellActions["runExternalRuntimeDoctor"];
  runStructureViewerAction: ShellActions["runStructureViewerAction"];
  runXtbActiveOperation: ShellActions["runXtbActiveOperation"];
  runXtbFepPreflight: ShellActions["runXtbFepPreflight"];
  runXtbGridScoring: ShellActions["runXtbGridScoring"];
  runXtbJob: ShellActions["runXtbJob"];
  runXtbKetcherSketch: ShellActions["runXtbKetcherSketch"];
  runXtbPoseRefinement: ShellActions["runXtbPoseRefinement"];
  saveKetcherDraft: ShellActions["saveKetcherDraft"];
  saveKetcherExportFile: ShellActions["saveKetcherExportFile"];
  saveMoleculeCollectionAs: ShellActions["saveMoleculeCollectionAs"];
  selectDocument: ShellActions["selectDocument"];
  selectTextStructure: ShellActions["selectTextStructure"];
  setActiveTab: ShellActions["selectTab"];
  setConformerJobs: SetState<ConformerJob[]>;
  setConformerSettings: ShellActions["setConformerSettings"];
  setDockActiveTab: ShellActions["setDockActiveTab"];
  setDockDocument: ShellActions["setDockDocument"];
  setDockOpen: ShellActions["setDockOpen"];
  setDockSize: ShellActions["setDockSize"];
  setDockTool: ShellActions["setDockTool"];
  setExpandedProjectIds: ShellActions["setExpandedProjectIds"];
  setPreference: ShellActions["setPreference"];
  setSidebarQuery: ShellActions["setSidebarQuery"];
  setStructureDragActive: ShellActions["setStructureDragActive"];
  setUpdatePreferences: ShellActions["setUpdatePreferences"];
  setXtbJobs: SetState<XtbJob[]>;
  setXtbSettings: ShellActions["setXtbSettings"];
  showActiveDocumentMetadata: ShellActions["showActiveDocumentMetadata"];
  showDocumentMetadata: ShellActions["showDocumentMetadata"];
  showTextFileMetadata: ShellActions["showTextFileMetadata"];
  tabs: MoleculeTab[];
  toggleDock: ShellActions["toggleDock"];
  toggleDockTab: ShellActions["toggleDockTab"];
  togglePinnedProjectRoot: (root: string) => void;
  togglePinnedStructure: ShellActions["togglePinnedStructure"];
  toggleProjectExpanded: ShellActions["toggleProjectExpanded"];
  toggleProjectsOpen: ShellActions["toggleProjectsOpen"];
  toggleSidebar: ShellActions["toggleSidebar"];
};

export function createAppShellActions(actions: ShellActions): ShellActions {
  return actions;
}

export function useAppShellActions({
  activeDocument,
  addDockDrop,
  addXyzrenderSheetItemsToDocument,
  appendGridRecords,
  applyGridDescriptorControls,
  applyGridDescriptorResults,
  applyKetcherToGridRow,
  backToApp,
  calculateGridDescriptors,
  canNavigateBack,
  canNavigateForward,
  cancelConformerJob,
  cancelXtbJob,
  checkConformerStatus,
  checkForUpdates,
  checkXtbStatus,
  chooseFiles,
  chooseWorkspace,
  clearCache,
  clearDescriptorSource,
  clearDirtyGridDocuments,
  clearKetcherImportRequest,
  clearRecentStructures,
  closeActiveDocument,
  closeAllDocuments,
  closeDocument,
  closeDockTab,
  closeGridRuntime,
  closeQuickLookPreview,
  closeTab,
  confirmDiscardDirtyGridDocument,
  confirmDiscardDirtyGridDocuments,
  copyActiveDocumentPath,
  copyDocumentPath,
  copyPath,
  documents,
  exportActivePreviewAsPng,
  exportActivePreviewAsSvg,
  exportDiagnostics,
  focusSidebarSearch,
  forgetDirtyGridDocument,
  forgetDirtyGridDocuments,
  generate3DConformer,
  installUpdate,
  installXtb,
  listChemicalEditorTargets,
  mergeMoleculeCollections,
  moveTab,
  navigateBack,
  navigateForward,
  openClipboard,
  openCommandPalette,
  openDescriptorSource,
  openDockPayload,
  openDockTab,
  openDockingDocument,
  openDockingStructureRecords,
  openDocuments,
  openFepNetworkPreview,
  openFepSetupWorkspace,
  openKetcher,
  openKetcherExportRaw,
  openKetcherSketch,
  openKetcherWithStructures,
  openLogs,
  openMostRecentStructure,
  openNewTab,
  openNewWindow,
  openPathInChemicalEditor,
  openPathWithDefaultApp,
  openPaths,
  openProjectFolder,
  openRecentStructure,
  openSettings,
  openSettingsSection,
  openStructureRecords,
  openTextDocuments,
  openUpdateRelease,
  openWorkspaceFolder,
  pushErrorStatus,
  pushStatus,
  reloadXyzrenderDocument,
  removeProjectRoot,
  renameProjectRoot,
  resetQuickLook,
  revealActiveDocument,
  revealDocument,
  revealPath,
  runConformerOperation,
  runExternalRuntimeDoctor,
  runStructureViewerAction,
  runXtbActiveOperation,
  runXtbFepPreflight,
  runXtbGridScoring,
  runXtbJob,
  runXtbKetcherSketch,
  runXtbPoseRefinement,
  saveKetcherDraft,
  saveKetcherExportFile,
  saveMoleculeCollectionAs,
  selectDocument,
  selectTextStructure,
  setActiveTab,
  setConformerJobs,
  setConformerSettings,
  setDockActiveTab,
  setDockDocument,
  setDockOpen,
  setDockSize,
  setDockTool,
  setExpandedProjectIds,
  setPreference,
  setSidebarQuery,
  setStructureDragActive,
  setUpdatePreferences,
  setXtbJobs,
  setXtbSettings,
  showActiveDocumentMetadata,
  showDocumentMetadata,
  showTextFileMetadata,
  tabs,
  toggleDock,
  toggleDockTab,
  togglePinnedProjectRoot,
  togglePinnedStructure,
  toggleProjectExpanded,
  toggleProjectsOpen,
  toggleSidebar,
}: UseAppShellActionsOptions) {
  return useMemo<ShellActions>(() => createAppShellActions({
    chooseFiles,
    openStructurePaths: async (paths: string[], options?: { mode?: OpenDocumentsMode }) => {
      await openDocuments(paths, undefined, undefined, options);
    },
    openTextPaths: async (paths: string[]) => {
      await openTextDocuments(paths);
    },
    openPaths,
    openStructureRecords,
    openRecentStructure,
    openMostRecentStructure,
    selectDocument,
    selectTab: setActiveTab,
    openNewTab,
    canNavigateBack,
    canNavigateForward,
    navigateBack,
    navigateForward,
    focusSidebarSearch,
    openCommandPalette,
    openClipboard,
    openNewWindow,
    openSettings,
    openSettingsSection,
    backToApp,
    openKetcher,
    openKetcherWithStructures,
    openKetcherExportRaw,
    saveKetcherExportFile,
    openFepNetworkPreview,
    applyKetcherToGridRow,
    openFepSetupWorkspace,
    openKetcherSketch,
    openDescriptorSource,
    clearDescriptorSource,
    applyGridDescriptorControls,
    applyGridDescriptorResults,
    calculateGridDescriptors,
    checkConformerStatus,
    runConformerOperation,
    cancelConformerJob,
    ...createJobHistoryShellActions({ pushStatus, setConformerJobs, setXtbJobs }),
    setConformerSettings,
    checkXtbStatus,
    installXtb,
    runXtbActiveOperation,
    runXtbJob,
    cancelXtbJob,
    runXtbKetcherSketch,
    runXtbGridScoring,
    runXtbPoseRefinement,
    runXtbFepPreflight,
    setXtbSettings,
    saveKetcherDraft,
    clearKetcherImportRequest,
    moveTab,
    chooseWorkspace,
    openWorkspaceFolder,
    openProjectFolder,
    ...createProjectShellActions({ pushStatus, removeProjectRoot, renameProjectRoot, togglePinnedProjectRoot }),
    toggleSidebar,
    toggleDock,
    toggleDockTab,
    setDockOpen,
    setDockSize,
    openDockTab,
    closeDockTab,
    setDockActiveTab,
    setDockDocument,
    setDockTool,
    ...createDockDropShellActions({ addDockDrop, pushStatus }),
    openDockPayload,
    toggleProjectsOpen,
    setExpandedProjectIds,
    setSidebarQuery,
    toggleProjectExpanded,
    togglePinnedStructure,
    ...createDocumentCloseShellActions({
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
    }),
    openDockingDocument,
    openDockingStructureRecords,
    appendGridRecords,
    addXyzrenderSheetItems: addXyzrenderSheetItemsToDocument,
    mergeMoleculeCollections,
    saveMoleculeCollectionAs,
    listChemicalEditorTargets,
    openPathInChemicalEditor,
    openPathWithDefaultApp,
    revealActiveDocument,
    revealDocument,
    revealPath,
    copyActiveDocumentPath,
    copyDocumentPath,
    copyPath,
    showActiveDocumentMetadata,
    showDocumentMetadata,
    showTextFileMetadata,
    closeQuickLookPreview,
    generate3DConformer,
    runStructureViewerAction,
    reloadXyzrenderDocument,
    selectTextStructure,
    exportActivePreviewAsPng,
    exportActivePreviewAsSvg,
    setStructureDragActive,
    ...createRecentShellActions({ clearRecentStructures, pushStatus }),
    clearCache,
    resetQuickLook,
    runExternalRuntimeDoctor,
    openLogs,
    exportDiagnostics,
    ...createUpdateShellActions({ checkForUpdates, installUpdate }),
    openUpdateRelease,
    setPreference,
    setUpdatePreferences,
  }), [activeDocument, addDockDrop, addXyzrenderSheetItemsToDocument, appendGridRecords, applyGridDescriptorControls, applyGridDescriptorResults, applyKetcherToGridRow, backToApp, calculateGridDescriptors, canNavigateBack, canNavigateForward, checkForUpdates, chooseFiles, chooseWorkspace, clearCache, clearDescriptorSource, clearDirtyGridDocuments, clearKetcherImportRequest, clearRecentStructures, closeActiveDocument, closeAllDocuments, closeDocument, closeDockTab, closeGridRuntime, closeQuickLookPreview, closeTab, confirmDiscardDirtyGridDocument, confirmDiscardDirtyGridDocuments, copyActiveDocumentPath, copyDocumentPath, copyPath, documents, exportActivePreviewAsPng, exportActivePreviewAsSvg, exportDiagnostics, focusSidebarSearch, forgetDirtyGridDocument, forgetDirtyGridDocuments, generate3DConformer, installUpdate, listChemicalEditorTargets, mergeMoleculeCollections, moveTab, navigateBack, navigateForward, openClipboard, openCommandPalette, openDescriptorSource, openDockingDocument, openDockingStructureRecords, openDockPayload, openDockTab, openDocuments, openFepNetworkPreview, openFepSetupWorkspace, openKetcher, openKetcherExportRaw, openKetcherSketch, openKetcherWithStructures, openLogs, openMostRecentStructure, openNewTab, openNewWindow, openPathInChemicalEditor, openPathWithDefaultApp, openPaths, openProjectFolder, openRecentStructure, openSettings, openSettingsSection, openStructureRecords, openTextDocuments, openUpdateRelease, openWorkspaceFolder, pushErrorStatus, pushStatus, reloadXyzrenderDocument, removeProjectRoot, renameProjectRoot, resetQuickLook, revealActiveDocument, revealDocument, revealPath, runExternalRuntimeDoctor, runStructureViewerAction, saveKetcherDraft, saveKetcherExportFile, saveMoleculeCollectionAs, selectDocument, selectTextStructure, setActiveTab, setDockActiveTab, setDockDocument, setDockOpen, setDockSize, setDockTool, setExpandedProjectIds, setPreference, setSidebarQuery, setUpdatePreferences, showActiveDocumentMetadata, showDocumentMetadata, showTextFileMetadata, tabs, toggleDock, toggleDockTab, togglePinnedProjectRoot, togglePinnedStructure, toggleProjectExpanded, toggleProjectsOpen, toggleSidebar]);
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
