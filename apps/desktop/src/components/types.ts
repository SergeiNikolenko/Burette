import type { FepSetupRequest, RecentStructure, ViewerDocument, ViewerPreferences } from "../types";
import type { MoleculeTab } from "../stores/molecule-store";
import type { StructureDragPayload } from "../lib/structure-drag";
import type { UpdatePreferences, UpdateState } from "../update";
import type { SidebarProject } from "../lib/sidebar-projects";

export type AppPage = "viewer" | "settings";
export type StatusKind = "info" | "error";

export type StatusNotice = {
  id: number;
  kind: StatusKind;
  message: string;
  details: string[];
};

export type KetcherSketchTarget = "grid" | "molstar" | "xyzrender" | "collection";

export type KetcherSketchRequest = {
  title: string;
  extension: "sdf";
  text: string;
  draftKet?: string;
  draftMolfile?: string;
  target: KetcherSketchTarget;
  collectionTargetPath?: string | null;
};

export type KetcherImportRequest = {
  id: number;
  paths: string[];
  fragments?: Array<{
    title: string;
    text: string;
  }>;
};

export type BuildInfo = {
  name: string;
  version: string;
  identifier: string;
  flavor: string | null;
  isDevBuild: boolean;
  isBrowserDev: boolean;
  notes: string[];
  limitations: string[];
};

export type ShellActions = {
  chooseFiles: () => void | Promise<void>;
  openStructurePaths: (paths: string[]) => void | Promise<void>;
  openStructureRecords: (records: StructureDragPayload["records"]) => void | Promise<void>;
  openRecentStructure: (structure: RecentStructure) => void | Promise<void>;
  openMostRecentStructure: () => void | Promise<void>;
  selectDocument: (id: string) => void;
  selectTab: (id: string) => void;
  openNewTab: () => void;
  canNavigateBack: boolean;
  canNavigateForward: boolean;
  navigateBack: () => void;
  navigateForward: () => void;
  focusSidebarSearch: () => void;
  openCommandPalette: () => void;
  openClipboard: () => void | Promise<void>;
  openSettings: () => void;
  openKetcher: () => void;
  openKetcherWithStructures: (paths: string[], fragments?: KetcherImportRequest["fragments"]) => void;
  openFepSetupWorkspace: (request: FepSetupRequest) => void;
  openKetcherSketch: (request: KetcherSketchRequest) => void | Promise<void>;
  saveKetcherDraft: (molfile: string) => void;
  clearKetcherImportRequest: (id: number) => void;
  moveTab: (id: string, toIndex: number) => void;
  chooseWorkspace: () => void | Promise<void>;
  openWorkspaceFolder: () => void | Promise<void>;
  openProjectFolder: (path: string | null) => void | Promise<void>;
  toggleSidebar: () => void;
  toggleProjectsOpen: () => void;
  setExpandedProjectIds: (projectIds: string[]) => void;
  setSidebarQuery: (query: string) => void;
  toggleProjectExpanded: (projectId: string) => void;
  togglePinnedStructure: (path: string) => void;
  closeDocument: (id: string) => void;
  closeTab: (id: string) => void;
  closeActiveDocument: () => void;
  clearAllDocuments: () => void;
  openDockingDocument: (receptorPath: string, ligandPaths: string[], options?: { activePose?: number | null }) => void | Promise<ViewerDocument | null>;
  openDockingStructureRecords: (receptorPath: string, ligandPaths: string[], records: StructureDragPayload["records"]) => void | Promise<void>;
  appendGridRecords: (targetDocumentId: string, payload: StructureDragPayload) => boolean;
  addXyzrenderSheetItems: (targetDocumentId: string, payload: StructureDragPayload) => boolean;
  mergeMoleculeCollections: (targetPath: string | null, paths: string[]) => void | Promise<void>;
  saveMoleculeCollectionAs: (targetPath: string) => void | Promise<void>;
  revealActiveDocument: () => void | Promise<void>;
  revealDocument: (document: ViewerDocument) => void | Promise<void>;
  copyActiveDocumentPath: () => void | Promise<void>;
  copyDocumentPath: (document: ViewerDocument) => void | Promise<void>;
  showActiveDocumentMetadata: () => void | Promise<void>;
  showDocumentMetadata: (document: ViewerDocument) => void | Promise<void>;
  exportActivePreviewAsPng: () => void | Promise<void>;
  exportActivePreviewAsSvg: () => void | Promise<void>;
  setStructureDragActive: (active: boolean) => void;
  clearRecentStructures: () => void;
  clearCache: () => void | Promise<void>;
  resetQuickLook: () => void | Promise<void>;
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
  tabs: MoleculeTab[];
  activeTab: MoleculeTab | null;
  activeTabId: string | null;
  activeDocument: ViewerDocument | null;
  activeDocumentId: string | null;
  visibleDocuments: ViewerDocument[];
  recentStructures: RecentStructure[];
  sidebarProjects: SidebarProject[];
  projectsOpen: boolean;
  expandedProjectIds: string[];
  pinnedStructurePaths: string[];
  workspacePath: string | null;
  page: AppPage;
  sidebarOpen: boolean;
  sidebarWidth: number;
  sidebarDragging: boolean;
  structureDragActive: boolean;
  poseReviewSelections: Record<string, number>;
  ketcherImportRequest: KetcherImportRequest | null;
  ketcherDraftMolfile: string;
  sidebarQuery: string;
  status: StatusNotice | null;
  dropActive: boolean;
  preferences: ViewerPreferences;
  update: UpdateState;
  buildInfo: BuildInfo;
};
