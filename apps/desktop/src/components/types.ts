import type { RecentStructure, ViewerDocument, ViewerPreferences } from "../types";
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

export type KetcherSketchTarget = "molstar" | "xyzrender" | "collection";

export type KetcherSketchRequest = {
  title: string;
  extension: "sdf";
  text: string;
  target: KetcherSketchTarget;
  collectionTargetPath?: string | null;
};

export type KetcherImportRequest = {
  id: number;
  paths: string[];
};

export type ShellActions = {
  chooseFiles: () => void | Promise<void>;
  openRecentStructure: (structure: RecentStructure) => void | Promise<void>;
  selectDocument: (id: string) => void;
  selectTab: (id: string) => void;
  openNewTab: () => void;
  canNavigateBack: boolean;
  canNavigateForward: boolean;
  navigateBack: () => void;
  navigateForward: () => void;
  focusSidebarSearch: () => void;
  openCommandPalette: () => void;
  openSettings: () => void;
  openKetcher: () => void;
  openKetcherWithStructures: (paths: string[]) => void;
  openKetcherSketch: (request: KetcherSketchRequest) => void | Promise<void>;
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
  openDockingDocument: (receptorPath: string, ligandPaths: string[]) => void | Promise<void>;
  addXyzrenderSheetItems: (targetDocumentId: string, payload: StructureDragPayload) => boolean;
  mergeMoleculeCollections: (targetPath: string | null, paths: string[]) => void | Promise<void>;
  saveMoleculeCollectionAs: (targetPath: string) => void | Promise<void>;
  setStructureDragActive: (active: boolean) => void;
  clearRecentStructures: () => void;
  clearCache: () => void | Promise<void>;
  resetQuickLook: () => void | Promise<void>;
  openLogs: () => void | Promise<void>;
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
  ketcherImportRequest: KetcherImportRequest | null;
  sidebarQuery: string;
  status: StatusNotice | null;
  dropActive: boolean;
  preferences: ViewerPreferences;
  update: UpdateState;
};
