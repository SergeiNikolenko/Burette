import type { RecentStructure, ViewerDocument, ViewerPreferences } from "../types";
import type { MoleculeTab } from "../stores/molecule-store";
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
  chooseWorkspace: () => void | Promise<void>;
  openWorkspaceFolder: () => void | Promise<void>;
  openProjectFolder: (path: string | null) => void | Promise<void>;
  toggleSidebar: () => void;
  setSidebarQuery: (query: string) => void;
  toggleProjectExpanded: (projectId: string) => void;
  closeDocument: (id: string) => void;
  closeTab: (id: string) => void;
  closeActiveDocument: () => void;
  clearAllDocuments: () => void;
  openDockingDocument: (receptorPath: string, ligandPaths: string[]) => void | Promise<void>;
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
  expandedProjectIds: string[];
  workspacePath: string | null;
  page: AppPage;
  sidebarOpen: boolean;
  sidebarWidth: number;
  sidebarDragging: boolean;
  structureDragActive: boolean;
  sidebarQuery: string;
  status: StatusNotice | null;
  dropActive: boolean;
  preferences: ViewerPreferences;
  update: UpdateState;
};
