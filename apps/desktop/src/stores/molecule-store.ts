import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  deserializeLocation,
  serializeLocation,
  type Location,
  type SerializedLocation,
} from "../components/editor-area/page-kinds";
import type { RecentStructure, ViewerDocument } from "../types";

const MAX_RECENT_STRUCTURES = 12;

export type MoleculeTab = {
  id: string;
  location: Location;
  back: Location[];
  forward: Location[];
};

export type SessionTab = {
  location: SerializedLocation;
  back: SerializedLocation[];
  forward: SerializedLocation[];
};

type MoleculeState = {
  documents: ViewerDocument[];
  tabs: MoleculeTab[];
  activeTabId: string | null;
  activeDocumentId: string | null;
  recentStructures: RecentStructure[];
  setDocuments: (documents: ViewerDocument[]) => void;
  addDocuments: (documents: ViewerDocument[]) => void;
  rememberRecentStructures: (documents: ViewerDocument[]) => void;
  clearRecentStructures: () => void;
  openNewTab: () => void;
  openSettingsTab: () => void;
  navigateBack: () => void;
  navigateForward: () => void;
  setActiveTab: (id: string) => void;
  setActiveDocument: (id: string) => void;
  closeTab: (id: string) => void;
  closeDocument: (id: string) => void;
  closeActiveDocument: () => void;
  closeAllDocuments: () => void;
  restoreSession: (tabs: SessionTab[], activeIndex: number | null) => void;
};

type PersistedMoleculeState = Pick<
  MoleculeState,
  "documents" | "tabs" | "activeTabId" | "recentStructures"
>;

let tabSequence = 0;

function createTabId() {
  tabSequence += 1;
  return `tab-${tabSequence}`;
}

function syncTabSequence(tabs: MoleculeTab[]) {
  let max = tabSequence;
  for (const tab of tabs) {
    const match = /^tab-(\d+)$/.exec(tab.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  tabSequence = max;
}

function dedupeTabIds(tabs: MoleculeTab[]) {
  syncTabSequence(tabs);
  const seen = new Set<string>();
  return tabs.map((tab) => {
    if (!seen.has(tab.id)) {
      seen.add(tab.id);
      return tab;
    }
    const next = { ...tab, id: createTabId() };
    seen.add(next.id);
    return next;
  });
}

export function createLauncherTab(id = createTabId()): MoleculeTab {
  return { id, location: { kind: "launcher" }, back: [], forward: [] };
}

export function createFileTab(document: ViewerDocument, id = createTabId()): MoleculeTab {
  return {
    id,
    location: { kind: "file", documentId: document.id, path: document.path },
    back: [],
    forward: [],
  };
}

export function createSettingsTab(id = createTabId()): MoleculeTab {
  return { id, location: { kind: "settings" }, back: [], forward: [] };
}

function cloneTab(tab: MoleculeTab): MoleculeTab {
  return { ...tab, back: [...tab.back], forward: [...tab.forward] };
}

function toRecentStructure(document: ViewerDocument): RecentStructure {
  return {
    path: document.path,
    title: document.title,
    extension: document.extension,
    renderer: document.renderer,
    byteCount: document.byteCount,
    openedAt: Date.now(),
  };
}

function documentForLocation(location: Location, documents: ViewerDocument[]) {
  if (location.kind !== "file") return null;
  return (
    documents.find((document) => document.id === location.documentId) ??
    documents.find((document) => document.path === location.path) ??
    null
  );
}

function activeDocumentIdFrom(tabs: MoleculeTab[], activeTabId: string | null, documents: ViewerDocument[]) {
  const tab = tabs.find((candidate) => candidate.id === activeTabId);
  const document = tab ? documentForLocation(tab.location, documents) : null;
  return document?.id ?? null;
}

function activeTabIdOrFirst(tabs: MoleculeTab[], activeTabId: string | null) {
  if (activeTabId && tabs.some((tab) => tab.id === activeTabId)) return activeTabId;
  return tabs[0]?.id ?? null;
}

function ensureTabs(tabs: MoleculeTab[]) {
  return tabs.length > 0 ? tabs : [createLauncherTab()];
}

function serializeTab(tab: MoleculeTab): SessionTab | null {
  const location = serializeLocation(tab.location);
  if (!location) return null;
  return {
    location,
    back: tab.back.map(serializeLocation).filter((location): location is SerializedLocation => location !== null),
    forward: tab.forward.map(serializeLocation).filter((location): location is SerializedLocation => location !== null),
  };
}

function hydrateTab(tab: SessionTab, id = createTabId()): MoleculeTab | null {
  const location = deserializeLocation(tab.location);
  if (!location) return null;
  return {
    id,
    location,
    back: tab.back.map(deserializeLocation).filter((location): location is Location => location !== null),
    forward: tab.forward.map(deserializeLocation).filter((location): location is Location => location !== null),
  };
}

function buildFileTabs(documents: ViewerDocument[]) {
  return documents.length > 0 ? documents.map((document) => createFileTab(document)) : [createLauncherTab()];
}

export function getMoleculeSessionSnapshot(state: Pick<MoleculeState, "tabs" | "activeTabId">) {
  const tabs = state.tabs.map(serializeTab).filter((tab): tab is SessionTab => tab !== null);
  const activeIndex = state.activeTabId ? state.tabs.findIndex((tab) => tab.id === state.activeTabId) : null;
  return { tabs, activeIndex: activeIndex !== null && activeIndex >= 0 ? activeIndex : null };
}

export const useMoleculeStore = create<MoleculeState>()(
  persist<MoleculeState, [], [], PersistedMoleculeState>(
    (set) => ({
      documents: [],
      tabs: [createLauncherTab()],
      activeTabId: "tab-1",
      activeDocumentId: null,
      recentStructures: [],
      setDocuments: (documents) =>
        set(() => {
          const tabs = buildFileTabs(documents);
          const activeTabId = tabs[0]?.id ?? null;
          return { documents, tabs, activeTabId, activeDocumentId: activeDocumentIdFrom(tabs, activeTabId, documents) };
        }),
      addDocuments: (incoming) =>
        set((state) => {
          const byPath = new Map(state.documents.map((document) => [document.path, document]));
          for (const document of incoming) byPath.set(document.path, document);
          const documents = Array.from(byPath.values());
          const tabs = state.tabs
            .filter((tab) => tab.location.kind !== "launcher")
            .map(cloneTab)
            .filter((tab) => tab.location.kind !== "file" || byPath.has(tab.location.path));

          let openedTabId: string | null = null;
          for (const document of incoming) {
            const existing = tabs.find((tab) => tab.location.kind === "file" && tab.location.path === document.path);
            if (existing) {
              existing.location = { kind: "file", documentId: document.id, path: document.path };
              openedTabId ??= existing.id;
            } else {
              const tab = createFileTab(document);
              tabs.push(tab);
              openedTabId ??= tab.id;
            }
          }

          const nextTabs = ensureTabs(tabs);
          let activeTabId = openedTabId ?? state.activeTabId;
          activeTabId = activeTabIdOrFirst(nextTabs, activeTabId);
          return { documents, tabs: nextTabs, activeTabId, activeDocumentId: activeDocumentIdFrom(nextTabs, activeTabId, documents) };
        }),
      rememberRecentStructures: (incoming) =>
        set((state) => {
          const byPath = new Map(state.recentStructures.map((structure) => [structure.path, structure]));
          for (const document of incoming) byPath.set(document.path, toRecentStructure(document));
          return {
            recentStructures: Array.from(byPath.values())
              .sort((a, b) => b.openedAt - a.openedAt)
              .slice(0, MAX_RECENT_STRUCTURES),
          };
        }),
      clearRecentStructures: () => set({ recentStructures: [] }),
      openNewTab: () =>
        set((state) => {
          const tab = createLauncherTab();
          const tabs = [...state.tabs, tab];
          return { tabs, activeTabId: tab.id, activeDocumentId: null };
        }),
      openSettingsTab: () =>
        set((state) => {
          const existing = state.tabs.find((tab) => tab.location.kind === "settings");
          if (existing) return { activeTabId: existing.id, activeDocumentId: null };
          const tab = createSettingsTab();
          return { tabs: [...state.tabs, tab], activeTabId: tab.id, activeDocumentId: null };
        }),
      navigateBack: () =>
        set((state) => {
          const active = state.tabs.find((tab) => tab.id === state.activeTabId);
          if (!active || active.back.length === 0) return state;
          const previous = active.back[active.back.length - 1];
          const tabs = state.tabs.map((tab) =>
            tab.id === active.id
              ? { ...tab, location: previous, back: active.back.slice(0, -1), forward: [active.location, ...active.forward] }
              : tab,
          );
          return { tabs, activeDocumentId: activeDocumentIdFrom(tabs, state.activeTabId, state.documents) };
        }),
      navigateForward: () =>
        set((state) => {
          const active = state.tabs.find((tab) => tab.id === state.activeTabId);
          if (!active || active.forward.length === 0) return state;
          const next = active.forward[0];
          const tabs = state.tabs.map((tab) =>
            tab.id === active.id
              ? { ...tab, location: next, back: [...active.back, active.location], forward: active.forward.slice(1) }
              : tab,
          );
          return { tabs, activeDocumentId: activeDocumentIdFrom(tabs, state.activeTabId, state.documents) };
        }),
      setActiveTab: (id) =>
        set((state) => {
          const activeTabId = activeTabIdOrFirst(state.tabs, id);
          return { activeTabId, activeDocumentId: activeDocumentIdFrom(state.tabs, activeTabId, state.documents) };
        }),
      setActiveDocument: (id) =>
        set((state) => {
          const document = state.documents.find((candidate) => candidate.id === id);
          if (!document) return state;
          const existing = state.tabs.find((tab) => tab.location.kind === "file" && (tab.location.documentId === id || tab.location.path === document.path));
          if (existing) {
            return { activeTabId: existing.id, activeDocumentId: document.id };
          }
          const tab = createFileTab(document);
          return { tabs: [...state.tabs, tab], activeTabId: tab.id, activeDocumentId: document.id };
        }),
      closeTab: (id) =>
        set((state) => {
          const closing = state.tabs.find((tab) => tab.id === id);
          let documents = state.documents;
          if (closing && closing.location.kind === "file") {
            const path = closing.location.path;
            documents = state.documents.filter((document) => document.path !== path);
          }
          const tabs = ensureTabs(state.tabs.filter((tab) => tab.id !== id));
          const activeTabId = activeTabIdOrFirst(tabs, state.activeTabId === id ? null : state.activeTabId);
          return { documents, tabs, activeTabId, activeDocumentId: activeDocumentIdFrom(tabs, activeTabId, documents) };
        }),
      closeDocument: (id) =>
        set((state) => {
          const document = state.documents.find((candidate) => candidate.id === id);
          if (!document) return state;
          const documents = state.documents.filter((candidate) => candidate.id !== id);
          const tabs = ensureTabs(state.tabs.filter((tab) => tab.location.kind !== "file" || tab.location.path !== document.path));
          const activeTabId = activeTabIdOrFirst(tabs, state.activeTabId);
          return { documents, tabs, activeTabId, activeDocumentId: activeDocumentIdFrom(tabs, activeTabId, documents) };
        }),
      closeActiveDocument: () =>
        set((state) => {
          if (!state.activeTabId) return state;
          const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
          if (!activeTab) return state;
          let documents = state.documents;
          const location = activeTab.location;
          if (location.kind === "file") {
            documents = state.documents.filter((document) => document.path !== location.path);
          }
          const tabs = ensureTabs(state.tabs.filter((tab) => tab.id !== activeTab.id));
          const activeTabId = activeTabIdOrFirst(tabs, null);
          return { documents, tabs, activeTabId, activeDocumentId: activeDocumentIdFrom(tabs, activeTabId, documents) };
        }),
      closeAllDocuments: () => {
        const tab = createLauncherTab();
        return set({ documents: [], tabs: [tab], activeTabId: tab.id, activeDocumentId: null });
      },
      restoreSession: (sessionTabs, activeIndex) =>
        set((state) => {
        const tabs = dedupeTabIds(ensureTabs(sessionTabs.map((tab) => hydrateTab(tab)).filter((tab): tab is MoleculeTab => tab !== null)));
          const requested = activeIndex === null ? null : tabs[activeIndex]?.id ?? null;
          const activeTabId = activeTabIdOrFirst(tabs, requested);
          return { tabs, activeTabId, activeDocumentId: activeDocumentIdFrom(tabs, activeTabId, state.documents) };
        }),
    }),
    {
      name: "burrete.molecule.session",
      partialize: (state) => ({
        documents: state.documents,
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        recentStructures: state.recentStructures,
      }),
      merge: (persisted, current) => {
        const stored = persisted as Partial<PersistedMoleculeState> | undefined;
        const documents = stored?.documents ?? current.documents;
        const tabs = dedupeTabIds(ensureTabs((stored?.tabs ?? current.tabs).map(cloneTab)));
        const activeTabId = activeTabIdOrFirst(tabs, stored?.activeTabId ?? current.activeTabId);
        return {
          ...current,
          documents,
          tabs,
          activeTabId,
          activeDocumentId: activeDocumentIdFrom(tabs, activeTabId, documents),
          recentStructures: stored?.recentStructures ?? current.recentStructures,
        };
      },
    },
  ),
);
