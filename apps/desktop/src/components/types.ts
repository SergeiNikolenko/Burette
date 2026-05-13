import type { RecentStructure, ViewerDocument, ViewerPreferences } from "../types";
import type { MoleculeTab } from "../stores/molecule-store";
import type { UpdatePreferences, UpdateState } from "../update";

export type AppPage = "viewer" | "settings";

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
  toggleSidebar: () => void;
  closeDocument: (id: string) => void;
  closeTab: (id: string) => void;
  closeActiveDocument: () => void;
  clearAllDocuments: () => void;
  clearRecentStructures: () => void;
  clearCache: () => void | Promise<void>;
  resetQuickLook: () => void | Promise<void>;
  openLogs: () => void | Promise<void>;
  checkForUpdates: () => void | Promise<void>;
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
  page: AppPage;
  sidebarOpen: boolean;
  sidebarWidth: number;
  sidebarDragging: boolean;
  sidebarQuery: string;
  status: string;
  dropActive: boolean;
  preferences: ViewerPreferences;
  update: UpdateState;
};
