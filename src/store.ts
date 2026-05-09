import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ViewerDocument, ViewerPreferences } from "./types";

type AppState = {
  documents: ViewerDocument[];
  activeDocumentId: string | null;
  sidebarOpen: boolean;
  preferences: ViewerPreferences;
  setDocuments: (documents: ViewerDocument[]) => void;
  addDocuments: (documents: ViewerDocument[]) => void;
  setActiveDocument: (id: string) => void;
  closeDocument: (id: string) => void;
  closeActiveDocument: () => void;
  closeAllDocuments: () => void;
  toggleSidebar: () => void;
  setPreference: <K extends keyof ViewerPreferences>(key: K, value: ViewerPreferences[K]) => void;
};

const defaultPreferences: ViewerPreferences = {
  theme: "auto",
  canvasBackground: "auto",
  rendererMode: "auto",
  xyzFastStyle: "default",
};

type PersistedAppState = Pick<AppState, "sidebarOpen" | "preferences">;

export const useAppStore = create<AppState>()(
  persist<AppState, [], [], PersistedAppState>((set) => ({
  documents: [],
  activeDocumentId: null,
  sidebarOpen: true,
  preferences: defaultPreferences,
  setDocuments: (documents) =>
    set({ documents, activeDocumentId: documents[0]?.id ?? null }),
  addDocuments: (incoming) =>
    set((state) => {
      const byPath = new Map(state.documents.map((document) => [document.path, document]));
      for (const document of incoming) byPath.set(document.path, document);
      const documents = Array.from(byPath.values()).sort((a, b) => a.title.localeCompare(b.title));
      return { documents, activeDocumentId: incoming[0]?.id ?? state.activeDocumentId ?? documents[0]?.id ?? null };
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
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setPreference: (key, value) => set((state) => ({ preferences: { ...state.preferences, [key]: value } })),
}), {
  name: "burrete.shell",
  partialize: (state) => ({
    sidebarOpen: state.sidebarOpen,
    preferences: state.preferences,
  }),
  merge: (persisted, current) => {
    const stored = persisted as Partial<PersistedAppState> | undefined;
    return {
      ...current,
      sidebarOpen: stored?.sidebarOpen ?? current.sidebarOpen,
      preferences: {
        ...current.preferences,
        ...stored?.preferences,
      },
    };
  },
}));
