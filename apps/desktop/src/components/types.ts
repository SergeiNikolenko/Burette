import type { ConformerJob, ConformerOperation, ConformerSettings, ConformerStatus, DockingSceneMode, FepSetupRequest, OpenDocumentsMode, RecentStructure, TextFileDocument, ViewerDocument, ViewerPreferences, ViewerReloadOptions, XtbJob, XtbOperation, XtbRunRequest, XtbSettings, XtbStatus } from "../types";
import type { MoleculeTab } from "../stores/molecule-store";
import type { StructureDragPayload } from "../lib/structure-drag";
import type { StructureViewerAction as BaseStructureViewerAction } from "../lib/structure-composition";
import type { TextStructureSelection } from "../lib/text-structure-selection";
import type { DescriptorSourcePayload, GridDescriptorControls, GridDescriptorResultRow, GridDescriptorRunOptions } from "../lib/descriptors";
import type { UpdatePreferences, UpdateState } from "../update";
import type { SidebarProject } from "../lib/sidebar-projects";
import type { AppSettingsSectionId } from "../lib/settings-sections";
import type { DockArea, DockDropInput, DockDroppedStructure, DockTab, DockTabKind, DockToolKind } from "../lib/dock";

export type { AppSettingsSectionId } from "../lib/settings-sections";

export type AppPage = "viewer" | "settings";
export type StatusKind = "info" | "success" | "error";
export type StructureViewerAction =
  | BaseStructureViewerAction
  | {
      type: "color_xtb_charges";
      label: string;
      charges: number[];
      chargeFilePath?: string;
    }
  | {
      type: "color_xtb_fukui";
      label: string;
      mode: "fplus" | "fminus" | "fzero";
      values: number[];
    };

export type StatusNotice = {
  id: number;
  kind: StatusKind;
  message: string;
  details: string[];
};

export type ViewerLigandSelection = {
  documentId: string;
  label: string;
  value: string;
  selector: Record<string, string | number | Array<string | number>>;
  atoms: number | null;
};

export type StructureOverlayMode = "single" | "all";

export type KetcherSketchTarget = "grid" | "molstar" | "generate3d" | "xyzrender" | "collection" | "xtb";

export type KetcherSketchRequest = {
  title: string;
  extension: "sdf" | "smi" | "csv" | "tsv";
  text: string;
  draftKet?: string;
  draftMolfile?: string;
  source3d?: KetcherSource3D;
  target: KetcherSketchTarget;
  collectionTargetPath?: string | null;
};

export type KetcherSource3D = {
  title: string;
  extension: string;
  text: string;
};

export type KetcherImportRequest = {
  id: number;
  paths: string[];
  fragments?: Array<{
    title: string;
    text: string;
    source3d?: KetcherSource3D;
    source?: {
      kind: "grid-row";
      documentId: string;
      rowIndex: number;
      title: string;
      extension: string;
    };
  }>;
};

export type BuildInfo = {
  name: string;
  version: string;
  identifier: string;
  flavor: string | null;
  isDevBuild: boolean;
  isBrowserDev: boolean;
  isAgentShell: boolean;
  notes: string[];
  limitations: string[];
};

export type ChemicalEditorTarget = {
  id: string;
  name: string;
  bundleId: string | null;
  appPath: string;
  iconPath?: string | null;
  iconUrl?: string | null;
  rank: number;
  supportedExtensions: string[];
  matchReason: string;
};

export type ShellActions = {
  chooseFiles: () => void | Promise<void>;
  openStructurePaths: (paths: string[], options?: { mode?: OpenDocumentsMode }) => void | Promise<void>;
  openTextPaths: (paths: string[]) => void | Promise<void>;
  openPaths: (paths: string[]) => void | Promise<void>;
  openStructureRecords: (records: StructureDragPayload["records"]) => void | Promise<void>;
  openStructureUrlInMolstar: (url: string) => void | Promise<void>;
  openRecentStructure: (structure: RecentStructure) => void | Promise<void>;
  openMostRecentStructure: () => void | Promise<void>;
  fetchPdbStructure: (pdbId: string) => void | Promise<void>;
  selectDocument: (id: string) => void;
  selectTab: (id: string) => void;
  openNewTab: () => void;
  canNavigateBack: boolean;
  canNavigateForward: boolean;
  navigateBack: () => void;
  navigateForward: () => void;
  undoWorkspaceAction: () => boolean;
  redoWorkspaceAction: () => boolean;
  focusSidebarSearch: () => void;
  openCommandPalette: () => void;
  openClipboard: () => void | Promise<void>;
  openNewWindow: () => void | Promise<void>;
  openSettings: () => void;
  openSettingsSection: (section: AppSettingsSectionId) => void;
  backToApp: () => void;
  openKetcher: () => void;
  openKetcherWithStructures: (paths: string[], fragments?: KetcherImportRequest["fragments"]) => void;
  openKetcherExportRaw: (request: {
    title: string;
    extension: string;
    text: string;
  }) => void;
  saveKetcherExportFile: (request: {
    title: string;
    extension: string;
    text: string;
  }) => void | Promise<void>;
  openFepNetworkPreview: (request?: { title?: string; graphmlText?: string }) => void;
  applyKetcherToGridRow: (request: {
    documentId: string;
    rowIndex: number;
    title: string;
    extension: string;
    text: string;
  }) => void;
  openFepSetupWorkspace: (request: FepSetupRequest) => void;
  openKetcherSketch: (request: KetcherSketchRequest) => void | Promise<void>;
  openDescriptorSource: (source: DescriptorSourcePayload) => void;
  clearDescriptorSource: () => void;
  applyGridDescriptorControls: (documentId: string, controls: GridDescriptorControls) => void;
  applyGridDescriptorResults: (documentId: string, rows: GridDescriptorResultRow[]) => void;
  calculateGridDescriptors: (documentId: string, options?: GridDescriptorRunOptions) => void;
  checkConformerStatus: () => void | Promise<void>;
  runConformerOperation: (operation: ConformerOperation, document?: ViewerDocument | null, selection?: StructureViewerAction | null) => void | Promise<void>;
  cancelConformerJob: (jobId: string) => void | Promise<void>;
  setConformerSettings: (settings: ConformerSettings) => void;
  clearConformerJobs: () => void;
  checkXtbStatus: () => void | Promise<void>;
  chooseXtbExecutable: () => void | Promise<void>;
  clearXtbExecutableSelection: () => void | Promise<void>;
  installXtb: () => void | Promise<void>;
  runXtbActiveOperation: (operation: XtbOperation) => void | Promise<void>;
  runXtbJob: (request: XtbRunRequest, options?: { title?: string; inputLabel?: string; openPrimary?: boolean; openOptimizedPoseInCurrentView?: boolean; poseSourceDocument?: ViewerDocument | null }) => void | Promise<void>;
  cancelXtbJob: (jobId: string) => void | Promise<void>;
  runXtbKetcherSketch: (request: KetcherSketchRequest) => void | Promise<void>;
  runXtbGridScoring: (document?: ViewerDocument | null) => void | Promise<void>;
  clearXtbJobs: () => void;
  setXtbSettings: (settings: XtbSettings) => void;
  saveKetcherDraft: (molfile: string) => void;
  clearKetcherImportRequest: (id: number) => void;
  moveTab: (id: string, toIndex: number) => void;
  chooseWorkspace: () => void | Promise<void>;
  openWorkspaceFolder: () => void | Promise<void>;
  openProjectFolder: (path: string | null) => void | Promise<void>;
  togglePinnedProjectRoot: (root: string) => void;
  renameProjectRoot: (root: string, name: string) => void;
  renameProjectFolder: (folderPath: string, name: string) => void;
  removeProjectRoot: (root: string) => void;
  toggleSidebar: () => void;
  toggleDock: (area: DockArea) => void;
  toggleDockTab: (area: DockArea, kind: DockTabKind) => void;
  setDockOpen: (area: DockArea, open: boolean) => void;
  setDockSize: (area: DockArea, size: number) => void;
  openDockTab: (area: DockArea, kind: DockTabKind) => void;
  closeDockTab: (area: DockArea, tabId: string) => void;
  setDockActiveTab: (area: DockArea, kind: DockTabKind) => void;
  setDockDocument: (area: DockArea, documentId: string | null) => void;
  setDockTool: (area: DockArea, tool: DockToolKind | null) => void;
  addDockDrop: (input: DockDropInput) => void;
  openDockPayload: (input: DockDropInput) => void | Promise<void>;
  toggleProjectsOpen: () => void;
  setExpandedProjectIds: (projectIds: string[]) => void;
  setSidebarQuery: (query: string) => void;
  toggleProjectExpanded: (projectId: string) => void;
  togglePinnedStructure: (path: string) => void;
  closeDocument: (id: string) => void | Promise<void>;
  closeTab: (id: string) => void | Promise<void>;
  closeOtherTabs: (id: string) => void | Promise<void>;
  closeActiveDocument: () => void | Promise<void>;
  clearAllDocuments: () => void | Promise<void>;
  openDockingDocument: (receptorPath: string, ligandPaths: string[], options?: { activePose?: number | null; sceneMode?: DockingSceneMode | null }) => void | Promise<ViewerDocument | null>;
  openDockingStructureRecords: (receptorPath: string, ligandPaths: string[], records: StructureDragPayload["records"]) => void | Promise<void>;
  appendGridRecords: (targetDocumentId: string, payload: StructureDragPayload) => boolean;
  addXyzrenderSheetItems: (targetDocumentId: string, payload: StructureDragPayload) => boolean;
  mergeMoleculeCollections: (targetPath: string | null, paths: string[]) => void | Promise<void>;
  saveMoleculeCollectionAs: (targetPath: string) => void | Promise<void>;
  listChemicalEditorTargets: (path: string) => Promise<ChemicalEditorTarget[]>;
  openPathInChemicalEditor: (path: string, targetId: string, targetName: string) => void | Promise<void>;
  openPathWithDefaultApp: (path: string) => void | Promise<void>;
  revealActiveDocument: () => void | Promise<void>;
  revealDocument: (document: ViewerDocument) => void | Promise<void>;
  revealPath: (path: string, label?: string) => void | Promise<void>;
  copyActiveDocumentPath: () => void | Promise<void>;
  copyDocumentPath: (document: ViewerDocument) => void | Promise<void>;
  copyPath: (path: string, label?: string) => void | Promise<void>;
  showActiveDocumentMetadata: () => void | Promise<void>;
  showDocumentMetadata: (document: ViewerDocument) => void | Promise<void>;
  showTextFileMetadata: (document: TextFileDocument) => void | Promise<void>;
  closeQuickLookPreview: () => void;
  generate3DConformer: (document: ViewerDocument) => void | Promise<void>;
  runStructureViewerAction: (document: ViewerDocument, action: StructureViewerAction) => void;
  reloadXyzrenderDocument: (document: ViewerDocument, options: ViewerReloadOptions) => void | Promise<void>;
  selectTextStructure: (document: TextFileDocument, selection: TextStructureSelection) => void;
  exportActivePreviewAsPng: () => void | Promise<void>;
  exportActivePreviewAsSvg: () => void | Promise<void>;
  setStructureDragActive: (active: boolean) => void;
  clearRecentStructures: () => void;
  clearCache: () => void | Promise<void>;
  resetQuickLook: () => void | Promise<void>;
  runExternalRuntimeDoctor: () => void | Promise<void>;
  openLogs: () => void | Promise<void>;
  exportDiagnostics: () => void | Promise<void>;
  checkForUpdates: () => void | Promise<void>;
  installUpdate: () => void | Promise<void>;
  openUpdateRelease: () => void | Promise<void>;
  setPreference: <K extends keyof ViewerPreferences>(key: K, value: ViewerPreferences[K]) => void;
  setUpdatePreferences: (preferences: UpdatePreferences) => void;
};

export type ShellViewState = {
  documents: ViewerDocument[];
  textDocuments: TextFileDocument[];
  tabs: MoleculeTab[];
  activeTab: MoleculeTab | null;
  activeTabId: string | null;
  activeDocument: ViewerDocument | null;
  activeDocumentId: string | null;
  quickLookDocument: ViewerDocument | null;
  quickLookError: string | null;
  quickLookStandalone: boolean;
  visibleDocuments: ViewerDocument[];
  recentStructures: RecentStructure[];
  sidebarProjects: SidebarProject[];
  projectsOpen: boolean;
  expandedProjectIds: string[];
  projectNameOverrides: Record<string, string>;
  pinnedStructurePaths: string[];
  workspacePath: string | null;
  page: AppPage;
  sidebarOpen: boolean;
  sidebarWidth: number;
  sidebarDragging: boolean;
  rightDockOpen: boolean;
  rightDockWidth: number;
  rightDockTabs: DockTab[];
  rightDockActiveTab: DockTabKind;
  rightDockDocumentId: string | null;
  rightDockTool: DockToolKind | null;
  rightDockDragging: boolean;
  bottomDockOpen: boolean;
  bottomDockHeight: number;
  bottomDockTabs: DockTab[];
  bottomDockActiveTab: DockTabKind;
  bottomDockDocumentId: string | null;
  bottomDockTool: DockToolKind | null;
  bottomDockDragging: boolean;
  dockDroppedStructures: DockDroppedStructure[];
  structureDragActive: boolean;
  poseReviewSelections: Record<string, number>;
  ketcherImportRequest: KetcherImportRequest | null;
  ketcherDraftMolfile: string;
  descriptorSource: DescriptorSourcePayload | null;
  sidebarQuery: string;
  status: StatusNotice | null;
  dropActive: boolean;
  preferences: ViewerPreferences;
  conformerStatus: ConformerStatus | null;
  conformerSettings: ConformerSettings;
  conformerJobs: ConformerJob[];
  viewerLigandSelection: ViewerLigandSelection | null;
  structureOverlayMode: StructureOverlayMode;
  xtbStatus: XtbStatus | null;
  xtbSettings: XtbSettings;
  xtbJobs: XtbJob[];
  update: UpdateState;
  buildInfo: BuildInfo;
};
