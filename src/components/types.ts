import type { ViewerDocument, ViewerPreferences } from "../types";
import type { UpdatePreferences, UpdateState } from "../update";

export type AppPage = "viewer" | "settings";

export type ShellActions = {
  chooseFiles: () => void | Promise<void>;
  selectDocument: (id: string) => void;
  focusSidebarSearch: () => void;
  openSettings: () => void;
  closeDocument: (id: string) => void;
  closeActiveDocument: () => void;
  clearAllDocuments: () => void;
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
  activeDocument: ViewerDocument | null;
  activeDocumentId: string | null;
  visibleDocuments: ViewerDocument[];
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
