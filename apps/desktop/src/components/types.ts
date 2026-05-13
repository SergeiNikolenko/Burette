import type { RecentFile, ViewerDocument, ViewerPreferences } from "../types";
import type { UpdatePreferences, UpdateState } from "../update";
import type { CommandPaletteIntent } from "../stores/ui-store";
export type { CommandPaletteIntent } from "../stores/ui-store";

export type AppPage = "viewer" | "settings" | "launcher";
export type DocumentLoadState = "loading" | "ready" | "error";

export type ShellTab =
  | { id: string; kind: "document"; document: ViewerDocument; title: string; loadState: DocumentLoadState }
  | { id: string; kind: "launcher" | "settings"; title: string };

export type ShellActions = {
  chooseFiles: () => void | Promise<void>;
  chooseFolder: () => void | Promise<void>;
  openWorkspace: (path: string) => void | Promise<void>;
  openWorkspaceFile: (path: string) => void | Promise<void>;
  openWorkspaceFileInNewTab: (path: string) => void | Promise<void>;
  createWorkspaceFile: (path: string) => void | Promise<void>;
  removeRecentWorkspace: (path: string) => void | Promise<void>;
  toggleSidebar: () => void;
  toggleTheme: () => void;
  selectTab: (id: string) => void;
  selectDocument: (id: string) => void;
  cycleDocument: (direction: 1 | -1) => void;
  navigateBack: () => void;
  navigateForward: () => void;
  reloadActive: () => void | Promise<void>;
  focusSidebarSearch: () => void;
  openLauncher: () => void;
  openSettings: () => void;
  openCommandPalette: (intent?: CommandPaletteIntent) => void;
  closeCommandPalette: () => void;
  closeTab: (id: string) => void;
  closeDocument: (id: string) => void;
  closeActiveDocument: () => void;
  closeAllTabs: () => void;
  clearAllDocuments: () => void;
  closeWorkspace: () => void;
  clearCache: () => void | Promise<void>;
  resetQuickLook: () => void | Promise<void>;
  openLogs: () => void | Promise<void>;
  checkForUpdates: () => void | Promise<void>;
  openUpdateRelease: () => void | Promise<void>;
  setPreference: <K extends keyof ViewerPreferences>(key: K, value: ViewerPreferences[K]) => void;
  setUpdatePreferences: (preferences: UpdatePreferences) => void;
};

export type ShellViewState = {
  tabs: ShellTab[];
  activeTabId: string | null;
  documents: ViewerDocument[];
  activeDocument: ViewerDocument | null;
  activeDocumentId: string | null;
  workspaceRoot: string | null;
  recentWorkspaces: string[];
  recentFiles: RecentFile[];
  page: AppPage;
  canNavigateBack: boolean;
  canNavigateForward: boolean;
  sidebarOpen: boolean;
  sidebarWidth: number;
  sidebarDragging: boolean;
  commandPaletteOpen: boolean;
  commandPaletteIntent: CommandPaletteIntent;
  status: string;
  dropActive: boolean;
  preferences: ViewerPreferences;
  update: UpdateState;
  instanceLabel: string | null;
};
