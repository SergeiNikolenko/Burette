import { useMemo } from "react";
import type { ShellActions } from "../components/types";
import type { DockDropInput } from "../lib/dock";
import type { WindowCloseMutationPermit } from "../lib/window-mutation-barrier";
import {
  useWorkspaceHistoryStore,
  workspaceHistoryNone,
  type WorkspaceHistoryGroup,
} from "../stores/workspace-history-store";
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
  chooseXtbExecutable: ShellActions["chooseXtbExecutable"];
  clearXtbExecutableSelection: ShellActions["clearXtbExecutableSelection"];
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
  confirmCloseSourceDocuments: (documentIds: string[]) => boolean;
  confirmDiscardDirtyGridDocument: (
    documentId: string | null | undefined,
  ) => Promise<WindowCloseMutationPermit | null>;
  confirmDiscardDirtyGridDocuments: (
    documentIds: string[],
  ) => Promise<WindowCloseMutationPermit | null>;
  copyActiveDocumentPath: ShellActions["copyActiveDocumentPath"];
  copyDocumentPath: ShellActions["copyDocumentPath"];
  copyPath: ShellActions["copyPath"];
  documents: ViewerDocument[];
  exportActivePreviewAsPng: ShellActions["exportActivePreviewAsPng"];
  exportActivePreviewAsSvg: ShellActions["exportActivePreviewAsSvg"];
  exportDiagnostics: ShellActions["exportDiagnostics"];
  fetchPdbStructure: ShellActions["fetchPdbStructure"];
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
  openStructureUrlInMolstar: ShellActions["openStructureUrlInMolstar"];
  openTextDocuments: (paths: string[]) => void | Promise<unknown>;
  openUpdateRelease: ShellActions["openUpdateRelease"];
  openWorkspaceFolder: ShellActions["openWorkspaceFolder"];
  pushErrorStatus: PushErrorStatus;
  pushStatus: PushStatus;
  reloadXyzrenderDocument: ShellActions["reloadXyzrenderDocument"];
  removeProjectRoot: (root: string) => void;
  renameProjectRoot: (root: string, name: string) => void;
  renameProjectFolder: (folderPath: string, name: string) => void;
  resetQuickLook: ShellActions["resetQuickLook"];
  revealActiveDocument: ShellActions["revealActiveDocument"];
  revealDocument: ShellActions["revealDocument"];
  revealPath: ShellActions["revealPath"];
  runConformerOperation: ShellActions["runConformerOperation"];
  runExternalRuntimeDoctor: ShellActions["runExternalRuntimeDoctor"];
  runStructureViewerAction: ShellActions["runStructureViewerAction"];
  runXtbActiveOperation: ShellActions["runXtbActiveOperation"];
  runXtbGridScoring: ShellActions["runXtbGridScoring"];
  runXtbJob: ShellActions["runXtbJob"];
  runXtbKetcherSketch: ShellActions["runXtbKetcherSketch"];
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
  setGridColumnFilter: ShellActions["setGridColumnFilter"];
  clearGridColumnFilters: ShellActions["clearGridColumnFilters"];
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

type OpeningShellActions = Pick<
  ShellActions,
  | "chooseFiles"
  | "openStructurePaths"
  | "openTextPaths"
  | "openPaths"
  | "openStructureRecords"
  | "openStructureUrlInMolstar"
  | "openRecentStructure"
  | "openMostRecentStructure"
  | "fetchPdbStructure"
  | "openClipboard"
>;

type NavigationShellActions = Pick<
  ShellActions,
  | "selectDocument"
  | "selectTab"
  | "openNewTab"
  | "canNavigateBack"
  | "canNavigateForward"
  | "navigateBack"
  | "navigateForward"
  | "undoWorkspaceAction"
  | "redoWorkspaceAction"
  | "focusSidebarSearch"
  | "openCommandPalette"
  | "openNewWindow"
  | "openSettings"
  | "openSettingsSection"
  | "backToApp"
  | "moveTab"
>;

type KetcherShellActions = Pick<
  ShellActions,
  | "openKetcher"
  | "openKetcherWithStructures"
  | "openKetcherExportRaw"
  | "saveKetcherExportFile"
  | "applyKetcherToGridRow"
  | "openKetcherSketch"
  | "saveKetcherDraft"
  | "clearKetcherImportRequest"
>;

type GridShellActions = Pick<
  ShellActions,
  | "openDescriptorSource"
  | "clearDescriptorSource"
  | "applyGridDescriptorControls"
  | "applyGridDescriptorResults"
  | "calculateGridDescriptors"
  | "appendGridRecords"
  | "addXyzrenderSheetItems"
>;

type ChemistryShellActions = Pick<
  ShellActions,
  | "checkConformerStatus"
  | "runConformerOperation"
  | "cancelConformerJob"
  | "clearConformerJobs"
  | "setConformerSettings"
  | "checkXtbStatus"
  | "chooseXtbExecutable"
  | "clearXtbExecutableSelection"
  | "installXtb"
  | "runXtbActiveOperation"
  | "runXtbJob"
  | "cancelXtbJob"
  | "runXtbKetcherSketch"
  | "runXtbGridScoring"
  | "clearXtbJobs"
  | "setXtbSettings"
>;

type WorkspaceShellActions = Pick<
  ShellActions,
  | "chooseWorkspace"
  | "openWorkspaceFolder"
  | "openProjectFolder"
  | "togglePinnedProjectRoot"
  | "renameProjectRoot"
  | "renameProjectFolder"
  | "removeProjectRoot"
  | "toggleProjectsOpen"
  | "setExpandedProjectIds"
  | "setSidebarQuery"
  | "toggleProjectExpanded"
  | "togglePinnedStructure"
  | "clearRecentStructures"
>;

type DockShellActions = Pick<
  ShellActions,
  | "toggleSidebar"
  | "toggleDock"
  | "toggleDockTab"
  | "setDockOpen"
  | "setDockSize"
  | "setGridColumnFilter"
  | "clearGridColumnFilters"
  | "openDockTab"
  | "closeDockTab"
  | "setDockActiveTab"
  | "setDockDocument"
  | "setDockTool"
  | "addDockDrop"
  | "openDockPayload"
  | "setStructureDragActive"
>;

type DocumentShellActions = Pick<
  ShellActions,
  | "closeDocument"
  | "closeTab"
  | "closeOtherTabs"
  | "closeActiveDocument"
  | "clearAllDocuments"
  | "listChemicalEditorTargets"
  | "openPathInChemicalEditor"
  | "openPathWithDefaultApp"
  | "revealActiveDocument"
  | "revealDocument"
  | "revealPath"
  | "copyActiveDocumentPath"
  | "copyDocumentPath"
  | "copyPath"
  | "showActiveDocumentMetadata"
  | "showDocumentMetadata"
  | "showTextFileMetadata"
  | "closeQuickLookPreview"
>;

type DockingShellActions = Pick<
  ShellActions,
  | "openDockingDocument"
  | "openDockingStructureRecords"
  | "mergeMoleculeCollections"
  | "saveMoleculeCollectionAs"
  | "openFepNetworkPreview"
  | "openFepSetupWorkspace"
>;

type ViewerShellActions = Pick<
  ShellActions,
  | "generate3DConformer"
  | "runStructureViewerAction"
  | "reloadXyzrenderDocument"
  | "selectTextStructure"
  | "exportActivePreviewAsPng"
  | "exportActivePreviewAsSvg"
>;

type MaintenanceShellActions = Pick<
  ShellActions,
  | "clearCache"
  | "resetQuickLook"
  | "runExternalRuntimeDoctor"
  | "openLogs"
  | "exportDiagnostics"
>;

type SettingsShellActions = Pick<
  ShellActions,
  | "checkForUpdates"
  | "installUpdate"
  | "openUpdateRelease"
  | "setPreference"
  | "setUpdatePreferences"
>;

export type AppShellActionSlices = {
  opening: OpeningShellActions;
  navigation: NavigationShellActions;
  ketcher: KetcherShellActions;
  grid: GridShellActions;
  chemistry: ChemistryShellActions;
  workspace: WorkspaceShellActions;
  dock: DockShellActions;
  documents: DocumentShellActions;
  docking: DockingShellActions;
  viewer: ViewerShellActions;
  maintenance: MaintenanceShellActions;
  settings: SettingsShellActions;
};

type WorkspaceHistoryActionSpec = {
  label: string;
  group: WorkspaceHistoryGroup;
};

const workspaceHistoryActionSpecs = {
  chooseFiles: { label: "Open structures", group: "documents" },
  openStructurePaths: { label: "Open structures", group: "documents" },
  openTextPaths: { label: "Open text files", group: "documents" },
  openPaths: { label: "Open files", group: "documents" },
  openStructureRecords: { label: "Open structures", group: "documents" },
  openRecentStructure: { label: "Open recent structure", group: "documents" },
  openMostRecentStructure: { label: "Open recent structure", group: "documents" },
  openClipboard: { label: "Open clipboard", group: "documents" },
  selectDocument: { label: "Select document", group: "navigation" },
  selectTab: { label: "Select tab", group: "navigation" },
  openNewTab: { label: "Open new tab", group: "documents" },
  openSettings: { label: "Open settings", group: "navigation" },
  openSettingsSection: { label: "Open settings section", group: "navigation" },
  backToApp: { label: "Back to app", group: "navigation" },
  moveTab: { label: "Move tab", group: "navigation" },
  openKetcher: { label: "Open Ketcher", group: "ketcher" },
  openKetcherWithStructures: { label: "Import into Ketcher", group: "ketcher" },
  openKetcherExportRaw: { label: "Open Ketcher export", group: "ketcher" },
  openKetcherSketch: { label: "Open Ketcher sketch", group: "ketcher" },
  clearKetcherImportRequest: { label: "Clear Ketcher import", group: "ketcher" },
  openFepNetworkPreview: { label: "Open FEP network", group: "docking" },
  openFepSetupWorkspace: { label: "Open FEP setup", group: "docking" },
  openDescriptorSource: { label: "Open descriptor source", group: "grid" },
  clearDescriptorSource: { label: "Clear descriptor source", group: "grid" },
  setConformerSettings: { label: "Change conformer settings", group: "chemistry" },
  setXtbSettings: { label: "Change xTB settings", group: "chemistry" },
  chooseWorkspace: { label: "Choose workspace", group: "workspace" },
  openProjectFolder: { label: "Open project folder", group: "workspace" },
  togglePinnedProjectRoot: { label: "Pin project", group: "workspace" },
  renameProjectRoot: { label: "Rename project", group: "workspace" },
  renameProjectFolder: { label: "Rename folder", group: "workspace" },
  removeProjectRoot: { label: "Remove project", group: "workspace" },
  toggleProjectsOpen: { label: "Toggle projects", group: "workspace" },
  setExpandedProjectIds: { label: "Expand projects", group: "workspace" },
  toggleProjectExpanded: { label: "Expand project", group: "workspace" },
  togglePinnedStructure: { label: "Pin structure", group: "workspace" },
  clearRecentStructures: { label: "Clear recent structures", group: "workspace" },
  toggleSidebar: { label: "Toggle sidebar", group: "layout" },
  toggleDock: { label: "Toggle dock", group: "layout" },
  toggleDockTab: { label: "Toggle dock tab", group: "layout" },
  setDockOpen: { label: "Toggle dock", group: "layout" },
  setDockSize: { label: "Resize dock", group: "layout" },
  openDockTab: { label: "Open dock tab", group: "layout" },
  closeDockTab: { label: "Close dock tab", group: "layout" },
  setDockActiveTab: { label: "Select dock tab", group: "layout" },
  setDockDocument: { label: "Select dock document", group: "layout" },
  setDockTool: { label: "Select dock tool", group: "layout" },
  addDockDrop: { label: "Add dock drop", group: "layout" },
  openDockPayload: { label: "Open dock payload", group: "documents" },
  openDockingDocument: { label: "Open docking document", group: "docking" },
  openDockingStructureRecords: { label: "Open docking structures", group: "docking" },
  mergeMoleculeCollections: { label: "Merge molecule collections", group: "documents" },
  saveMoleculeCollectionAs: { label: "Save molecule collection", group: "documents" },
  closeDocument: { label: "Close document", group: "documents" },
  closeTab: { label: "Close tab", group: "documents" },
  closeActiveDocument: { label: "Close active tab", group: "documents" },
  clearAllDocuments: { label: "Close all tabs", group: "documents" },
  generate3DConformer: { label: "Generate 3D conformer", group: "chemistry" },
  reloadXyzrenderDocument: { label: "Reload xyzrender document", group: "documents" },
  setPreference: { label: "Change preference", group: "settings" },
  setUpdatePreferences: { label: "Change update preference", group: "settings" },
} satisfies Partial<Record<keyof ShellActions, WorkspaceHistoryActionSpec>>;

const workspaceHistoryNoneActions = new Set<keyof ShellActions>([
  "focusSidebarSearch",
  "openCommandPalette",
  "openNewWindow",
  "saveKetcherExportFile",
  "applyKetcherToGridRow",
  "saveKetcherDraft",
  "applyGridDescriptorControls",
  "applyGridDescriptorResults",
  "calculateGridDescriptors",
  "appendGridRecords",
  "addXyzrenderSheetItems",
  "checkConformerStatus",
  "runConformerOperation",
  "cancelConformerJob",
  "clearConformerJobs",
  "checkXtbStatus",
  "chooseXtbExecutable",
  "clearXtbExecutableSelection",
  "installXtb",
  "runXtbActiveOperation",
  "runXtbJob",
  "cancelXtbJob",
  "runXtbKetcherSketch",
  "runXtbGridScoring",
  "clearXtbJobs",
  "openWorkspaceFolder",
  "setSidebarQuery",
  "setStructureDragActive",
  "listChemicalEditorTargets",
  "openPathInChemicalEditor",
  "openPathWithDefaultApp",
  "revealActiveDocument",
  "revealDocument",
  "revealPath",
  "copyActiveDocumentPath",
  "copyDocumentPath",
  "copyPath",
  "showActiveDocumentMetadata",
  "showDocumentMetadata",
  "showTextFileMetadata",
  "runStructureViewerAction",
  "selectTextStructure",
  "exportActivePreviewAsPng",
  "exportActivePreviewAsSvg",
  "clearCache",
  "resetQuickLook",
  "runExternalRuntimeDoctor",
  "openLogs",
  "exportDiagnostics",
  "checkForUpdates",
  "installUpdate",
  "openUpdateRelease",
]);

export function createWorkspaceHistoryShellActions(
  actions: ShellActions,
  options: {
    canNavigateBack: boolean;
    canNavigateForward: boolean;
    canRedoWorkspace: boolean;
    canUndoWorkspace: boolean;
  },
): ShellActions {
  const wrapped = { ...actions };
  const writable = wrapped as Record<keyof ShellActions, unknown>;
  for (const [key, spec] of Object.entries(workspaceHistoryActionSpecs) as Array<[keyof ShellActions, WorkspaceHistoryActionSpec]>) {
    const action = actions[key];
    if (typeof action !== "function") continue;
    writable[key] = ((...args: unknown[]) => (
      useWorkspaceHistoryStore.getState().withWorkspaceHistory(spec.label, spec.group, () => (
        (action as (...args: unknown[]) => unknown)(...args)
      ))
    ));
  }
  for (const key of workspaceHistoryNoneActions) {
    const action = actions[key];
    if (typeof action !== "function") continue;
    writable[key] = ((...args: unknown[]) => (
      workspaceHistoryNone(() => (action as (...args: unknown[]) => unknown)(...args))
    ));
  }
  return {
    ...wrapped,
    canNavigateBack: options.canUndoWorkspace || options.canNavigateBack,
    canNavigateForward: options.canRedoWorkspace || options.canNavigateForward,
    navigateBack: () => {
      if (!useWorkspaceHistoryStore.getState().undoWorkspaceAction()) {
        actions.navigateBack();
      }
    },
    navigateForward: () => {
      if (!useWorkspaceHistoryStore.getState().redoWorkspaceAction()) {
        actions.navigateForward();
      }
    },
    undoWorkspaceAction: () => useWorkspaceHistoryStore.getState().undoWorkspaceAction(),
    redoWorkspaceAction: () => useWorkspaceHistoryStore.getState().redoWorkspaceAction(),
  };
}

export function createAppShellActions(actions: ShellActions): ShellActions {
  return flattenAppShellActionSlices(createAppShellActionSlices(actions));
}

export function flattenAppShellActionSlices(slices: AppShellActionSlices): ShellActions {
  return {
    ...slices.opening,
    ...slices.navigation,
    ...slices.ketcher,
    ...slices.grid,
    ...slices.chemistry,
    ...slices.workspace,
    ...slices.dock,
    ...slices.documents,
    ...slices.docking,
    ...slices.viewer,
    ...slices.maintenance,
    ...slices.settings,
  };
}

export function createAppShellActionSlices(actions: ShellActions): AppShellActionSlices {
  return {
    opening: {
      chooseFiles: actions.chooseFiles,
      openStructurePaths: actions.openStructurePaths,
      openTextPaths: actions.openTextPaths,
      openPaths: actions.openPaths,
      openStructureRecords: actions.openStructureRecords,
      openStructureUrlInMolstar: actions.openStructureUrlInMolstar,
      openRecentStructure: actions.openRecentStructure,
      openMostRecentStructure: actions.openMostRecentStructure,
      fetchPdbStructure: actions.fetchPdbStructure,
      openClipboard: actions.openClipboard,
    },
    navigation: {
      selectDocument: actions.selectDocument,
      selectTab: actions.selectTab,
      openNewTab: actions.openNewTab,
      canNavigateBack: actions.canNavigateBack,
      canNavigateForward: actions.canNavigateForward,
      navigateBack: actions.navigateBack,
      navigateForward: actions.navigateForward,
      undoWorkspaceAction: actions.undoWorkspaceAction,
      redoWorkspaceAction: actions.redoWorkspaceAction,
      focusSidebarSearch: actions.focusSidebarSearch,
      openCommandPalette: actions.openCommandPalette,
      openNewWindow: actions.openNewWindow,
      openSettings: actions.openSettings,
      openSettingsSection: actions.openSettingsSection,
      backToApp: actions.backToApp,
      moveTab: actions.moveTab,
    },
    ketcher: {
      openKetcher: actions.openKetcher,
      openKetcherWithStructures: actions.openKetcherWithStructures,
      openKetcherExportRaw: actions.openKetcherExportRaw,
      saveKetcherExportFile: actions.saveKetcherExportFile,
      applyKetcherToGridRow: actions.applyKetcherToGridRow,
      openKetcherSketch: actions.openKetcherSketch,
      saveKetcherDraft: actions.saveKetcherDraft,
      clearKetcherImportRequest: actions.clearKetcherImportRequest,
    },
    grid: {
      openDescriptorSource: actions.openDescriptorSource,
      clearDescriptorSource: actions.clearDescriptorSource,
      applyGridDescriptorControls: actions.applyGridDescriptorControls,
      applyGridDescriptorResults: actions.applyGridDescriptorResults,
      calculateGridDescriptors: actions.calculateGridDescriptors,
      appendGridRecords: actions.appendGridRecords,
      addXyzrenderSheetItems: actions.addXyzrenderSheetItems,
    },
    chemistry: {
      checkConformerStatus: actions.checkConformerStatus,
      runConformerOperation: actions.runConformerOperation,
      cancelConformerJob: actions.cancelConformerJob,
      clearConformerJobs: actions.clearConformerJobs,
      setConformerSettings: actions.setConformerSettings,
      checkXtbStatus: actions.checkXtbStatus,
      chooseXtbExecutable: actions.chooseXtbExecutable,
      clearXtbExecutableSelection: actions.clearXtbExecutableSelection,
      installXtb: actions.installXtb,
      runXtbActiveOperation: actions.runXtbActiveOperation,
      runXtbJob: actions.runXtbJob,
      cancelXtbJob: actions.cancelXtbJob,
      runXtbKetcherSketch: actions.runXtbKetcherSketch,
      runXtbGridScoring: actions.runXtbGridScoring,
      clearXtbJobs: actions.clearXtbJobs,
      setXtbSettings: actions.setXtbSettings,
    },
    workspace: {
      chooseWorkspace: actions.chooseWorkspace,
      openWorkspaceFolder: actions.openWorkspaceFolder,
      openProjectFolder: actions.openProjectFolder,
      togglePinnedProjectRoot: actions.togglePinnedProjectRoot,
      renameProjectRoot: actions.renameProjectRoot,
      renameProjectFolder: actions.renameProjectFolder,
      removeProjectRoot: actions.removeProjectRoot,
      toggleProjectsOpen: actions.toggleProjectsOpen,
      setExpandedProjectIds: actions.setExpandedProjectIds,
      setSidebarQuery: actions.setSidebarQuery,
      toggleProjectExpanded: actions.toggleProjectExpanded,
      togglePinnedStructure: actions.togglePinnedStructure,
      clearRecentStructures: actions.clearRecentStructures,
    },
    dock: {
      toggleSidebar: actions.toggleSidebar,
      toggleDock: actions.toggleDock,
      toggleDockTab: actions.toggleDockTab,
      setDockOpen: actions.setDockOpen,
      setDockSize: actions.setDockSize,
      setGridColumnFilter: actions.setGridColumnFilter,
      clearGridColumnFilters: actions.clearGridColumnFilters,
      openDockTab: actions.openDockTab,
      closeDockTab: actions.closeDockTab,
      setDockActiveTab: actions.setDockActiveTab,
      setDockDocument: actions.setDockDocument,
      setDockTool: actions.setDockTool,
      addDockDrop: actions.addDockDrop,
      openDockPayload: actions.openDockPayload,
      setStructureDragActive: actions.setStructureDragActive,
    },
    documents: {
      closeDocument: actions.closeDocument,
      closeTab: actions.closeTab,
      closeOtherTabs: actions.closeOtherTabs,
      closeActiveDocument: actions.closeActiveDocument,
      clearAllDocuments: actions.clearAllDocuments,
      listChemicalEditorTargets: actions.listChemicalEditorTargets,
      openPathInChemicalEditor: actions.openPathInChemicalEditor,
      openPathWithDefaultApp: actions.openPathWithDefaultApp,
      revealActiveDocument: actions.revealActiveDocument,
      revealDocument: actions.revealDocument,
      revealPath: actions.revealPath,
      copyActiveDocumentPath: actions.copyActiveDocumentPath,
      copyDocumentPath: actions.copyDocumentPath,
      copyPath: actions.copyPath,
      showActiveDocumentMetadata: actions.showActiveDocumentMetadata,
      showDocumentMetadata: actions.showDocumentMetadata,
      showTextFileMetadata: actions.showTextFileMetadata,
      closeQuickLookPreview: actions.closeQuickLookPreview,
    },
    docking: {
      openDockingDocument: actions.openDockingDocument,
      openDockingStructureRecords: actions.openDockingStructureRecords,
      mergeMoleculeCollections: actions.mergeMoleculeCollections,
      saveMoleculeCollectionAs: actions.saveMoleculeCollectionAs,
      openFepNetworkPreview: actions.openFepNetworkPreview,
      openFepSetupWorkspace: actions.openFepSetupWorkspace,
    },
    viewer: {
      generate3DConformer: actions.generate3DConformer,
      runStructureViewerAction: actions.runStructureViewerAction,
      reloadXyzrenderDocument: actions.reloadXyzrenderDocument,
      selectTextStructure: actions.selectTextStructure,
      exportActivePreviewAsPng: actions.exportActivePreviewAsPng,
      exportActivePreviewAsSvg: actions.exportActivePreviewAsSvg,
    },
    maintenance: {
      clearCache: actions.clearCache,
      resetQuickLook: actions.resetQuickLook,
      runExternalRuntimeDoctor: actions.runExternalRuntimeDoctor,
      openLogs: actions.openLogs,
      exportDiagnostics: actions.exportDiagnostics,
    },
    settings: {
      checkForUpdates: actions.checkForUpdates,
      installUpdate: actions.installUpdate,
      openUpdateRelease: actions.openUpdateRelease,
      setPreference: actions.setPreference,
      setUpdatePreferences: actions.setUpdatePreferences,
    },
  };
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
  chooseXtbExecutable,
  clearXtbExecutableSelection,
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
  confirmCloseSourceDocuments,
  copyActiveDocumentPath,
  copyDocumentPath,
  copyPath,
  documents,
  exportActivePreviewAsPng,
  exportActivePreviewAsSvg,
  exportDiagnostics,
  fetchPdbStructure,
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
  openStructureUrlInMolstar,
  openTextDocuments,
  openUpdateRelease,
  openWorkspaceFolder,
  pushErrorStatus,
  pushStatus,
  reloadXyzrenderDocument,
  removeProjectRoot,
  renameProjectRoot,
  renameProjectFolder,
  resetQuickLook,
  revealActiveDocument,
  revealDocument,
  revealPath,
  runConformerOperation,
  runExternalRuntimeDoctor,
  runStructureViewerAction,
  runXtbActiveOperation,
  runXtbGridScoring,
  runXtbJob,
  runXtbKetcherSketch,
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
  setGridColumnFilter,
  clearGridColumnFilters,
}: UseAppShellActionsOptions) {
  const canUndoWorkspace = useWorkspaceHistoryStore((state) => state.canUndo);
  const canRedoWorkspace = useWorkspaceHistoryStore((state) => state.canRedo);

  return useMemo<ShellActions>(() => createWorkspaceHistoryShellActions(createAppShellActions({
    chooseFiles,
    openStructurePaths: async (paths: string[], options?: { mode?: OpenDocumentsMode }) => {
      await openDocuments(paths, undefined, undefined, options);
    },
    openTextPaths: async (paths: string[]) => {
      await openTextDocuments(paths);
    },
    openPaths,
    openStructureRecords,
    openStructureUrlInMolstar,
    openRecentStructure,
    openMostRecentStructure,
    fetchPdbStructure,
    selectDocument,
    selectTab: setActiveTab,
    openNewTab,
    canNavigateBack,
    canNavigateForward,
    navigateBack,
    navigateForward,
    undoWorkspaceAction: () => useWorkspaceHistoryStore.getState().undoWorkspaceAction(),
    redoWorkspaceAction: () => useWorkspaceHistoryStore.getState().redoWorkspaceAction(),
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
    chooseXtbExecutable,
    clearXtbExecutableSelection,
    installXtb,
    runXtbActiveOperation,
    runXtbJob,
    cancelXtbJob,
    runXtbKetcherSketch,
    runXtbGridScoring,
    setXtbSettings,
    saveKetcherDraft,
    clearKetcherImportRequest,
    moveTab,
    chooseWorkspace,
    openWorkspaceFolder,
    openProjectFolder,
    ...createProjectShellActions({ pushStatus, removeProjectRoot, renameProjectRoot, renameProjectFolder, togglePinnedProjectRoot }),
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
      confirmCloseSourceDocuments,
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
    setGridColumnFilter,
    clearGridColumnFilters,
  }), {
    canNavigateBack,
    canNavigateForward,
    canRedoWorkspace,
    canUndoWorkspace,
  }), [activeDocument, addDockDrop, addXyzrenderSheetItemsToDocument, appendGridRecords, applyGridDescriptorControls, applyGridDescriptorResults, applyKetcherToGridRow, backToApp, calculateGridDescriptors, canNavigateBack, canNavigateForward, canRedoWorkspace, canUndoWorkspace, checkForUpdates, chooseFiles, chooseWorkspace, clearCache, clearDescriptorSource, clearDirtyGridDocuments, clearKetcherImportRequest, clearRecentStructures, closeActiveDocument, closeAllDocuments, closeDocument, closeDockTab, closeGridRuntime, closeQuickLookPreview, closeTab, confirmCloseSourceDocuments, confirmDiscardDirtyGridDocument, confirmDiscardDirtyGridDocuments, copyActiveDocumentPath, copyDocumentPath, copyPath, documents, exportActivePreviewAsPng, exportActivePreviewAsSvg, exportDiagnostics, fetchPdbStructure, focusSidebarSearch, forgetDirtyGridDocument, forgetDirtyGridDocuments, generate3DConformer, installUpdate, listChemicalEditorTargets, mergeMoleculeCollections, moveTab, navigateBack, navigateForward, openClipboard, openCommandPalette, openDescriptorSource, openDockingDocument, openDockingStructureRecords, openDockPayload, openDockTab, openDocuments, openFepNetworkPreview, openFepSetupWorkspace, openKetcher, openKetcherExportRaw, openKetcherSketch, openKetcherWithStructures, openLogs, openMostRecentStructure, openNewTab, openNewWindow, openPathInChemicalEditor, openPathWithDefaultApp, openPaths, openProjectFolder, openRecentStructure, openSettings, openSettingsSection, openStructureRecords, openStructureUrlInMolstar, openTextDocuments, openUpdateRelease, openWorkspaceFolder, pushErrorStatus, pushStatus, reloadXyzrenderDocument, removeProjectRoot, renameProjectFolder, renameProjectRoot, resetQuickLook, revealActiveDocument, revealDocument, revealPath, runExternalRuntimeDoctor, runStructureViewerAction, saveKetcherDraft, saveKetcherExportFile, saveMoleculeCollectionAs, selectDocument, selectTextStructure, setActiveTab, setDockActiveTab, setDockDocument, setDockOpen, setDockSize, setDockTool, setExpandedProjectIds, setPreference, setSidebarQuery, setUpdatePreferences, showActiveDocumentMetadata, showDocumentMetadata, showTextFileMetadata, tabs, toggleDock, toggleDockTab, togglePinnedProjectRoot, togglePinnedStructure, toggleProjectExpanded, toggleProjectsOpen, toggleSidebar]);
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
  renameProjectFolder,
  togglePinnedProjectRoot,
}: {
  pushStatus: PushStatus;
  removeProjectRoot: (root: string) => void;
  renameProjectRoot: (root: string, name: string) => void;
  renameProjectFolder: (folderPath: string, name: string) => void;
  togglePinnedProjectRoot: (root: string) => void;
}): Pick<ShellActions, "togglePinnedProjectRoot" | "renameProjectRoot" | "renameProjectFolder" | "removeProjectRoot"> {
  return {
    togglePinnedProjectRoot: (root: string) => {
      togglePinnedProjectRoot(root);
      pushStatus("Project pin updated");
    },
    renameProjectRoot: (root: string, name: string) => {
      renameProjectRoot(root, name);
      pushStatus(name.trim() ? "Project renamed" : "Project name reset");
    },
    renameProjectFolder: (folderPath: string, name: string) => {
      renameProjectFolder(folderPath, name);
      pushStatus(name.trim() ? "Folder renamed" : "Folder name reset");
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
  confirmCloseSourceDocuments,
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
  confirmCloseSourceDocuments: (documentIds: string[]) => boolean;
  confirmDiscardDirtyGridDocument: (
    documentId: string | null | undefined,
  ) => Promise<WindowCloseMutationPermit | null>;
  confirmDiscardDirtyGridDocuments: (
    documentIds: string[],
  ) => Promise<WindowCloseMutationPermit | null>;
  documents: ViewerDocument[];
  forgetDirtyGridDocument: (documentId: string | null | undefined) => void;
  forgetDirtyGridDocuments: (documentIds: string[]) => void;
  pushStatus: PushStatus;
  tabs: MoleculeTab[];
}): Pick<ShellActions, "closeDocument" | "closeTab" | "closeOtherTabs" | "closeActiveDocument" | "clearAllDocuments"> {
  // Closing runs to completion straight away. It used to freeze the document's
  // grid and wait for in-flight mutations first, but that wait had no timeout,
  // so one unfinished operation left the "Finishing current change…" overlay up
  // for good and blocked every later close.
  const completeClose = (permit: WindowCloseMutationPermit, close: () => void) => {
    try {
      close();
    } finally {
      permit.release();
    }
  };

  const documentIdForTab = (tab: MoleculeTab | undefined) => {
    if (tab?.location.kind !== "file") return null;
    const location = tab.location;
    const document = documents.find((candidate) => (
      candidate.id === location.documentId
      || candidate.path === location.path
    ));
    return document?.id ?? location.documentId ?? null;
  };

  return {
    closeDocument: async (id: string) => {
      if (!confirmCloseSourceDocuments([id])) return;
      const permit = await confirmDiscardDirtyGridDocument(id);
      if (!permit) return;
      completeClose(permit, () => {
        closeGridRuntime(id);
        forgetDirtyGridDocument(id);
        closeDocument(id);
      });
    },
    closeTab: async (id: string) => {
      const tab = tabs.find((candidate) => candidate.id === id);
      const targetDocumentId = documentIdForTab(tab);
      const documentIds = targetDocumentId ? [targetDocumentId] : [];
      if (!confirmCloseSourceDocuments(documentIds)) return;
      const permit = await confirmDiscardDirtyGridDocuments(documentIds);
      if (!permit) return;
      completeClose(permit, () => {
        closeGridRuntime(targetDocumentId);
        forgetDirtyGridDocument(targetDocumentId);
        closeTab(id);
      });
    },
    closeOtherTabs: async (id: string) => {
      const otherTabs = tabs.filter((tab) => tab.id !== id);
      if (otherTabs.length === 0) return;
      const documentIds = Array.from(new Set(
        otherTabs
          .map((tab) => documentIdForTab(tab))
          .filter((documentId): documentId is string => documentId !== null),
      ));
      if (!confirmCloseSourceDocuments(documentIds)) return;
      const permit = await confirmDiscardDirtyGridDocuments(documentIds);
      if (!permit) return;
      completeClose(permit, () => {
        for (const documentId of documentIds) closeGridRuntime(documentId);
        forgetDirtyGridDocuments(documentIds);
        for (const tab of otherTabs) closeTab(tab.id);
        pushStatus("Closed other tabs");
      });
    },
    closeActiveDocument: async () => {
      const documentId = activeDocument?.id;
      if (activeDocument && !confirmCloseSourceDocuments([activeDocument.id])) return;
      const permit = await confirmDiscardDirtyGridDocument(documentId);
      if (!permit) return;
      completeClose(permit, () => {
        closeGridRuntime(documentId);
        forgetDirtyGridDocument(documentId);
        closeActiveDocument();
        pushStatus("Closed active tab");
      });
    },
    clearAllDocuments: async () => {
      const documentIds = documents.map((document) => document.id);
      if (!confirmCloseSourceDocuments(documentIds)) return;
      const permit = await confirmDiscardDirtyGridDocuments(documentIds);
      if (!permit) return;
      completeClose(permit, () => {
        for (const document of documents) closeGridRuntime(document.id);
        clearDirtyGridDocuments();
        closeAllDocuments();
        pushStatus("Closed all tabs");
      });
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
