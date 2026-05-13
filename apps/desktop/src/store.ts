import { create } from "zustand";
import { persist } from "zustand/middleware";
import settingsSchema from "../shared/settings.schema.json";
import type { RecentFile, ViewerDocument, ViewerPreferences, WorkspaceEntry } from "./types";

type AppState = {
  documents: ViewerDocument[];
  activeDocumentId: string | null;
  workspaceRoot: string | null;
  recentWorkspaces: string[];
  recentFiles: RecentFile[];
  directoryCache: Map<string, WorkspaceEntry[]>;
  sidebarOpen: boolean;
  sidebarWidth: number;
  preferences: ViewerPreferences;
  setDocuments: (documents: ViewerDocument[]) => void;
  addDocuments: (documents: ViewerDocument[]) => void;
  appendDocuments: (documents: ViewerDocument[]) => void;
  setWorkspaceRoot: (path: string | null) => void;
  setRecentWorkspaces: (paths: string[]) => void;
  pushRecentFiles: (paths: string[]) => void;
  pruneRecentFiles: (paths: string[]) => void;
  setWorkspaceDirectory: (path: string, entries: WorkspaceEntry[]) => void;
  setActiveDocument: (id: string) => void;
  closeDocument: (id: string) => void;
  closeActiveDocument: () => void;
  closeAllDocuments: () => void;
  closeWorkspace: () => void;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  setPreference: <K extends keyof ViewerPreferences>(key: K, value: ViewerPreferences[K]) => void;
  setPreferences: (preferences: Partial<ViewerPreferences>) => void;
};

export const defaultPreferences = Object.fromEntries(
  settingsSchema.settings.map((setting) => [setting.key, setting.default]),
) as ViewerPreferences;

type PersistedAppState = Pick<AppState, "sidebarWidth" | "preferences" | "recentFiles">;

export const useAppStore = create<AppState>()(
  persist<AppState, [], [], PersistedAppState>((set) => ({
  documents: [],
  activeDocumentId: null,
  workspaceRoot: null,
  recentWorkspaces: [],
  recentFiles: [],
  directoryCache: new Map(),
  sidebarOpen: true,
  sidebarWidth: 268,
  preferences: defaultPreferences,
  setDocuments: (documents) =>
    set({ documents, activeDocumentId: documents[0]?.id ?? null }),
  addDocuments: (incoming) =>
    set((state) => {
      const incomingPaths = new Set(incoming.map((document) => document.path));
      const documents = [
        ...state.documents.filter((document) => !incomingPaths.has(document.path)),
        ...incoming,
      ];
      return { documents, activeDocumentId: incoming[0]?.id ?? state.activeDocumentId ?? documents[0]?.id ?? null };
    }),
  appendDocuments: (incoming) =>
    set((state) => {
      const documents = [...state.documents, ...incoming];
      return { documents, activeDocumentId: incoming[0]?.id ?? state.activeDocumentId ?? documents[0]?.id ?? null };
    }),
  setWorkspaceRoot: (path) => set({ workspaceRoot: path }),
  setRecentWorkspaces: (paths) => set({ recentWorkspaces: paths }),
  pushRecentFiles: (paths) =>
    set((state) => {
      const now = Date.now();
      const incoming = Array.from(new Set(paths.filter(Boolean)));
      if (!incoming.length) return state;
      const incomingSet = new Set(incoming);
      const recentFiles = [
        ...incoming.map((path) => ({ path, openedAt: now })),
        ...state.recentFiles.filter((entry) => !incomingSet.has(entry.path)),
      ].slice(0, 50);
      return { recentFiles };
    }),
  pruneRecentFiles: (paths) =>
    set((state) => {
      const stale = new Set(paths);
      if (!stale.size) return state;
      return { recentFiles: state.recentFiles.filter((entry) => !stale.has(entry.path)) };
    }),
  setWorkspaceDirectory: (path, entries) =>
    set((state) => {
      const directoryCache = new Map(state.directoryCache);
      directoryCache.set(path, entries);
      return { directoryCache };
    }),
  setActiveDocument: (id) => set({ activeDocumentId: id }),
  closeDocument: (id) =>
    set((state) => {
      const documents = state.documents.filter((document) => document.id !== id);
      const activeDocumentId = state.activeDocumentId === id ? documents[0]?.id ?? null : state.activeDocumentId;
      return { documents, activeDocumentId };
    }),
  closeActiveDocument: () =>
    set((state) => {
      if (!state.activeDocumentId) return state;
      const documents = state.documents.filter((document) => document.id !== state.activeDocumentId);
      return { documents, activeDocumentId: documents[0]?.id ?? null };
    }),
  closeAllDocuments: () => set({ documents: [], activeDocumentId: null }),
  closeWorkspace: () =>
    set({ documents: [], activeDocumentId: null, workspaceRoot: null, directoryCache: new Map() }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarWidth: (width) => set({ sidebarWidth: Math.max(220, Math.min(420, Math.round(width))) }),
  setPreference: (key, value) => set((state) => ({ preferences: { ...state.preferences, [key]: value } })),
  setPreferences: (preferences) =>
    set((state) => ({
      preferences: {
        ...state.preferences,
        ...preferences,
        themeOverrides: {
          light: {
            ...state.preferences.themeOverrides.light,
            ...preferences.themeOverrides?.light,
          },
          dark: {
            ...state.preferences.themeOverrides.dark,
            ...preferences.themeOverrides?.dark,
          },
        },
      },
    })),
}), {
  name: "burrete.shell",
  partialize: (state) => ({
    sidebarWidth: state.sidebarWidth,
    preferences: state.preferences,
    recentFiles: state.recentFiles,
  }),
  merge: (persisted, current) => {
    const stored = persisted as Partial<PersistedAppState> | undefined;
    return {
      ...current,
      sidebarWidth: stored?.sidebarWidth ?? current.sidebarWidth,
      recentFiles: stored?.recentFiles ?? current.recentFiles,
      preferences: {
        ...current.preferences,
        ...stored?.preferences,
        themeOverrides: {
          light: {
            ...current.preferences.themeOverrides.light,
            ...stored?.preferences?.themeOverrides?.light,
          },
          dark: {
            ...current.preferences.themeOverrides.dark,
            ...stored?.preferences?.themeOverrides?.dark,
          },
        },
      },
    };
  },
}));
