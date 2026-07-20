import { create } from "zustand";
import { persist } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  deserializeLocation,
  serializeLocation,
  type FepNetworkLocation,
  type FepSetupLocation,
  type KetcherLocation,
  type Location,
  type PoseReviewLocation,
  type SerializedLocation,
  type TextFileLocation,
} from "../components/editor-area/page-kinds";
import { DEFAULT_SETTINGS_SECTION, type AppSettingsSectionId } from "../lib/settings-sections";
import type { RecentStructure, TextFileDocument, ViewerDocument } from "../types";
import {
  isTemporaryDocumentPath,
  isPersistentRecentStructure,
  isPersistentViewerDocument,
} from "../lib/temporary-documents";
import {
  applyGlobalRecentStructuresSnapshot,
  globalRecentStructuresRevision,
  GLOBAL_RECENT_STRUCTURES_STORAGE_KEY,
  loadGlobalRecentStructures,
  loadGlobalRecentStructuresSnapshot,
  normalizeGlobalRecentStructures,
  saveGlobalRecentStructures,
  type GlobalRecentStructuresSnapshot,
} from "../lib/global-recent-structures";
import { isTauriRuntime } from "../lib/tauri";
import { workspaceStorageKey } from "../lib/window-scope";

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
  textDocuments: TextFileDocument[];
  tabs: MoleculeTab[];
  activeTabId: string | null;
  activeDocumentId: string | null;
  recentStructures: RecentStructure[];
  setDocuments: (documents: ViewerDocument[]) => void;
  addDocuments: (documents: ViewerDocument[]) => void;
  addBackgroundDocuments: (documents: ViewerDocument[]) => void;
  replaceDocument: (documentId: string, replacement: ViewerDocument) => void;
  openDocumentsInActiveTab: (documents: ViewerDocument[], options?: { backLocation?: Location }) => void;
  addTextDocuments: (documents: TextFileDocument[]) => void;
  addBackgroundTextDocuments: (documents: TextFileDocument[]) => void;
  openTextDocumentsInActiveTab: (documents: TextFileDocument[], options?: { backLocation?: Location }) => void;
  rememberRecentStructures: (documents: ViewerDocument[]) => void;
  pruneRecentStructures: (
    checkedDocuments: Array<Pick<RecentStructure, "path" | "openedAt">>,
    existingPaths: string[],
  ) => void;
  clearRecentStructures: () => void;
  openNewTab: () => void;
  openFepNetworkTab: (location: FepNetworkLocation) => void;
  openFepSetupTab: (location: FepSetupLocation) => void;
  openKetcherTab: (location?: KetcherLocation) => void;
  openPoseReviewTab: (location: PoseReviewLocation) => void;
  openSettingsTab: (section?: AppSettingsSectionId) => void;
  openSettingsSection: (section: AppSettingsSectionId) => void;
  activateLastNonSettingsTab: () => void;
  navigateBack: () => void;
  navigateForward: () => void;
  setActiveTab: (id: string) => void;
  setActiveDocument: (id: string) => void;
  moveTab: (id: string, toIndex: number) => void;
  closeTab: (id: string) => void;
  closeDocument: (id: string) => void;
  closeActiveDocument: () => void;
  closeAllDocuments: () => void;
  restoreSession: (tabs: SessionTab[], activeIndex: number | null) => void;
  restoreSnapshot: (snapshot: MoleculeStoreSnapshot) => void;
};

export type MoleculeStoreSnapshot = {
  documents: ViewerDocument[];
  textDocuments: TextFileDocument[];
  tabs: MoleculeTab[];
  activeTabId: string | null;
  activeDocumentId: string | null;
  recentStructures: RecentStructure[];
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

function fileLocation(document: ViewerDocument): Location {
  return { kind: "file", documentId: document.id, path: document.path };
}

function replaceFileLocation(
  location: Location,
  documentId: string,
  previousPath: string,
  replacement: ViewerDocument,
): Location {
  if (location.kind !== "file"
    || (location.documentId !== documentId && location.path !== previousPath)) {
    return location;
  }
  return fileLocation(replacement);
}

export function createTextFileTab(document: TextFileDocument, id = createTabId()): MoleculeTab {
  return {
    id,
    location: { kind: "text-file", documentId: document.id, path: document.path },
    back: [],
    forward: [],
  };
}

function textFileLocation(document: TextFileDocument): TextFileLocation {
  return { kind: "text-file", documentId: document.id, path: document.path };
}

export function createSettingsTab(id = createTabId()): MoleculeTab {
  return { id, location: { kind: "settings", section: DEFAULT_SETTINGS_SECTION }, back: [], forward: [] };
}

export function createKetcherTab(id = createTabId(), location: KetcherLocation = { kind: "ketcher" }): MoleculeTab {
  return { id, location, back: [], forward: [] };
}

export function createFepSetupTab(location: FepSetupLocation, id = createTabId()): MoleculeTab {
  return { id, location, back: [], forward: [] };
}

export function createFepNetworkTab(location: FepNetworkLocation, id = createTabId()): MoleculeTab {
  return { id, location, back: [], forward: [] };
}

export function createPoseReviewTab(location: PoseReviewLocation, id = createTabId()): MoleculeTab {
  return { id, location, back: [], forward: [] };
}

function cloneTab(tab: MoleculeTab): MoleculeTab {
  return { ...tab, back: [...tab.back], forward: [...tab.forward] };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sameLocation(left: Location, right: Location) {
  if (left.kind !== right.kind) return false;
  if (left.kind === "file" && right.kind === "file") return left.path === right.path;
  if (left.kind === "text-file" && right.kind === "text-file") return left.path === right.path;
  return true;
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

function mergedRecentStructures(existing: RecentStructure[], incoming: RecentStructure[]) {
  return normalizeGlobalRecentStructures([...existing, ...incoming]);
}

function prunedRecentStructures(
  current: RecentStructure[],
  checkedDocuments: Array<Pick<RecentStructure, "path" | "openedAt">>,
  existingPaths: string[],
) {
  const checked = new Map(checkedDocuments.map((document) => [document.path, document.openedAt]));
  const existing = new Set(existingPaths);
  return current.filter((structure) => {
    const checkedOpenedAt = checked.get(structure.path);
    return checkedOpenedAt === undefined
      || structure.openedAt > checkedOpenedAt
      || existing.has(structure.path);
  });
}

function reconcileRecentStructures(request: Promise<GlobalRecentStructuresSnapshot>) {
  void request
    .then(applyRecentStructuresSnapshot)
    .catch(() => {
      // The local optimistic list remains usable if native synchronization is unavailable.
    });
}

function applyRecentStructuresSnapshot(snapshot: GlobalRecentStructuresSnapshot) {
  const recentStructures = applyGlobalRecentStructuresSnapshot(snapshot);
  if (recentStructures) useMoleculeStore.setState({ recentStructures });
}

async function initializeNativeRecentDocuments() {
  try {
    const unlisten = await listen<GlobalRecentStructuresSnapshot>(
      "recent-documents:changed",
      (event) => applyRecentStructuresSnapshot(event.payload),
    );
    window.addEventListener("beforeunload", () => unlisten(), { once: true });
  } catch {
    // The command response and native persistence still keep Recent Documents usable.
  }
  const initial = loadGlobalRecentStructuresSnapshot() ?? { revision: 0, documents: [] };
  reconcileRecentStructures(invoke("initialize_recent_documents", {
    documents: initial.documents,
    revision: Math.max(initial.revision, globalRecentStructuresRevision()),
  }));
}

function recentStructuresForMigration(
  stored: RecentStructure[] | undefined,
  current: RecentStructure[],
) {
  const global = loadGlobalRecentStructures();
  if (global !== null) return global;
  const migrated = (stored ?? current).filter(isPersistentRecentStructure);
  saveGlobalRecentStructures(migrated);
  return migrated;
}

function persistedTabs(tabs: MoleculeTab[]) {
  return tabs.filter((tab) => (
    tab.location.kind !== "settings" &&
    tab.location.kind !== "file" &&
    tab.location.kind !== "text-file" &&
    tab.location.kind !== "fep-setup" &&
    tab.location.kind !== "fep-network" &&
    tab.location.kind !== "pose-review"
  ));
}

function documentForLocation(location: Location, documents: ViewerDocument[]) {
  if (location.kind === "fep-network") return null;
  if (location.kind === "fep-setup" || location.kind === "pose-review") {
    return (
      documents.find((document) => document.id === location.dockingDocumentId) ??
      documents.find((document) => document.path === location.dockingPath) ??
      null
    );
  }
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

function moveTabToIndex(tabs: MoleculeTab[], id: string, toIndex: number) {
  const fromIndex = tabs.findIndex((tab) => tab.id === id);
  if (fromIndex < 0) return tabs;
  const nextIndex = Math.max(0, Math.min(tabs.length - 1, Math.round(toIndex)));
  if (fromIndex === nextIndex) return tabs;
  const nextTabs = [...tabs];
  const [tab] = nextTabs.splice(fromIndex, 1);
  nextTabs.splice(nextIndex, 0, tab);
  return nextTabs;
}

function ensureTabs(tabs: MoleculeTab[]) {
  return tabs.length > 0 ? tabs : [createLauncherTab()];
}

function collapseDuplicateKetcherTabs(tabs: MoleculeTab[], preferredActiveId: string | null = null) {
  const ketcherTabs = tabs.filter((tab) => tab.location.kind === "ketcher");
  if (ketcherTabs.length <= 1) return tabs;

  const keepId = (
    preferredActiveId ? ketcherTabs.find((tab) => tab.id === preferredActiveId)?.id : null
  ) ?? ketcherTabs[0].id;
  return tabs.filter((tab) => tab.location.kind !== "ketcher" || tab.id === keepId);
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

function shouldIgnorePersistedSession() {
  if (typeof window === "undefined") return false;
  if (new URLSearchParams(window.location.search).has("devFiles")) return true;
  return window.location.protocol === "http:" && (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost");
}

function devFilesPersistedSession(recentStructures: RecentStructure[]): PersistedMoleculeState {
  return {
    documents: [],
    tabs: [{ id: "tab-1", location: { kind: "launcher" }, back: [], forward: [] }],
    activeTabId: "tab-1",
    recentStructures: recentStructures.filter(isPersistentRecentStructure),
  };
}

export function getMoleculeSessionSnapshot(state: Pick<MoleculeState, "tabs" | "activeTabId">) {
  const tabs = state.tabs.map(serializeTab).filter((tab): tab is SessionTab => tab !== null);
  const activeIndex = state.activeTabId ? state.tabs.findIndex((tab) => tab.id === state.activeTabId) : null;
  return { tabs, activeIndex: activeIndex !== null && activeIndex >= 0 ? activeIndex : null };
}

export function getMoleculeStoreSnapshot(): MoleculeStoreSnapshot {
  const state = useMoleculeStore.getState();
  return cloneJson({
    documents: state.documents,
    textDocuments: state.textDocuments,
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    activeDocumentId: state.activeDocumentId,
    recentStructures: state.recentStructures,
  });
}

export const useMoleculeStore = create<MoleculeState>()(
  persist<MoleculeState, [], [], PersistedMoleculeState>(
    (set) => ({
      documents: [],
      textDocuments: [],
      tabs: [createLauncherTab()],
      activeTabId: "tab-1",
      activeDocumentId: null,
      recentStructures: loadGlobalRecentStructures() ?? [],
      setDocuments: (documents) =>
        set(() => {
          const tabs = buildFileTabs(documents);
          const activeTabId = tabs[0]?.id ?? null;
          return { documents, textDocuments: [], tabs, activeTabId, activeDocumentId: activeDocumentIdFrom(tabs, activeTabId, documents) };
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
          const tabByPath = new Map<string, MoleculeTab>();
          for (const tab of tabs) {
            if (tab.location.kind === "file") tabByPath.set(tab.location.path, tab);
          }

          let openedTabId: string | null = null;
          for (const document of incoming) {
            const existing = tabByPath.get(document.path);
            if (existing) {
              existing.location = { kind: "file", documentId: document.id, path: document.path };
              openedTabId ??= existing.id;
            } else {
              const tab = createFileTab(document);
              tabs.push(tab);
              tabByPath.set(document.path, tab);
              openedTabId ??= tab.id;
            }
          }

          const nextTabs = ensureTabs(tabs);
          let activeTabId = openedTabId ?? state.activeTabId;
          activeTabId = activeTabIdOrFirst(nextTabs, activeTabId);
          return { documents, tabs: nextTabs, activeTabId, activeDocumentId: activeDocumentIdFrom(nextTabs, activeTabId, documents) };
        }),
      addBackgroundDocuments: (incoming) =>
        set((state) => {
          if (incoming.length === 0) return state;
          const byId = new Map(state.documents.map((document) => [document.id, document]));
          for (const document of incoming) byId.set(document.id, document);
          const documents = Array.from(byId.values());
          return { documents, activeDocumentId: activeDocumentIdFrom(state.tabs, state.activeTabId, documents) };
        }),
      replaceDocument: (documentId, replacement) =>
        set((state) => {
          const previous = state.documents.find((document) => document.id === documentId);
          if (!previous) return state;
          const documents = state.documents
            .filter((document) => (
              document.id === documentId
              || (document.id !== replacement.id && document.path !== replacement.path)
            ))
            .map((document) => (document.id === documentId ? replacement : document));
          const tabs = state.tabs.map((tab) => ({
            ...tab,
            location: replaceFileLocation(tab.location, documentId, previous.path, replacement),
            back: tab.back.map((location) => (
              replaceFileLocation(location, documentId, previous.path, replacement)
            )),
            forward: tab.forward.map((location) => (
              replaceFileLocation(location, documentId, previous.path, replacement)
            )),
          }));
          return {
            documents,
            tabs,
            activeDocumentId: activeDocumentIdFrom(tabs, state.activeTabId, documents),
          };
        }),
      openDocumentsInActiveTab: (incoming, options = {}) =>
        set((state) => {
          if (incoming.length === 0) return state;
          const byPath = new Map(state.documents.map((document) => [document.path, document]));
          for (const document of incoming) byPath.set(document.path, document);
          const documents = Array.from(byPath.values());
          const active = state.tabs.find((tab) => tab.id === state.activeTabId);
          let tabs = state.tabs
            .filter((tab) => tab.location.kind !== "launcher")
            .map(cloneTab)
            .filter((tab) => tab.location.kind !== "file" || byPath.has(tab.location.path));

          const firstDocument = incoming[0];
          const nextLocation = fileLocation(firstDocument);
          let targetTab = active ? tabs.find((tab) => tab.id === active.id) ?? cloneTab(active) : createFileTab(firstDocument);
          const previousLocation = options.backLocation ?? targetTab.location;
          targetTab = {
            ...targetTab,
            location: nextLocation,
            back: sameLocation(previousLocation, nextLocation) ? targetTab.back : [...targetTab.back, previousLocation],
            forward: [],
          };
          tabs = tabs.filter((tab) => (
            tab.id !== targetTab.id &&
            (tab.location.kind !== "file" || tab.location.path !== firstDocument.path)
          ));
          tabs.push(targetTab);

          const tabByPath = new Map<string, MoleculeTab>();
          for (const tab of tabs) {
            if (tab.location.kind === "file") tabByPath.set(tab.location.path, tab);
          }
          tabByPath.set(firstDocument.path, targetTab);

          for (const document of incoming.slice(1)) {
            const existing = tabByPath.get(document.path);
            if (existing) {
              existing.location = fileLocation(document);
            } else {
              const tab = createFileTab(document);
              tabs.push(tab);
              tabByPath.set(document.path, tab);
            }
          }

          const nextTabs = ensureTabs(tabs);
          const activeTabId = activeTabIdOrFirst(nextTabs, targetTab.id);
          return { documents, tabs: nextTabs, activeTabId, activeDocumentId: activeDocumentIdFrom(nextTabs, activeTabId, documents) };
        }),
      addTextDocuments: (incoming) =>
        set((state) => {
          const byPath = new Map(state.textDocuments.map((document) => [document.path, document]));
          for (const document of incoming) byPath.set(document.path, document);
          const textDocuments = Array.from(byPath.values());
          const tabs = state.tabs
            .filter((tab) => tab.location.kind !== "launcher")
            .map(cloneTab)
            .filter((tab) => tab.location.kind !== "text-file" || byPath.has(tab.location.path));
          const tabByPath = new Map<string, MoleculeTab>();
          for (const tab of tabs) {
            if (tab.location.kind === "text-file") tabByPath.set(tab.location.path, tab);
          }

          let openedTabId: string | null = null;
          for (const document of incoming) {
            const existing = tabByPath.get(document.path);
            if (existing) {
              existing.location = textFileLocation(document);
              openedTabId ??= existing.id;
            } else {
              const tab = createTextFileTab(document);
              tabs.push(tab);
              tabByPath.set(document.path, tab);
              openedTabId ??= tab.id;
            }
          }

          const nextTabs = ensureTabs(tabs);
          let activeTabId = openedTabId ?? state.activeTabId;
          activeTabId = activeTabIdOrFirst(nextTabs, activeTabId);
          return { textDocuments, tabs: nextTabs, activeTabId, activeDocumentId: activeDocumentIdFrom(nextTabs, activeTabId, state.documents) };
        }),
      addBackgroundTextDocuments: (incoming) =>
        set((state) => {
          if (incoming.length === 0) return state;
          const byPath = new Map(state.textDocuments.map((document) => [document.path, document]));
          for (const document of incoming) byPath.set(document.path, document);
          return { textDocuments: Array.from(byPath.values()) };
        }),
      openTextDocumentsInActiveTab: (incoming, options = {}) =>
        set((state) => {
          if (incoming.length === 0) return state;
          const byPath = new Map(state.textDocuments.map((document) => [document.path, document]));
          for (const document of incoming) byPath.set(document.path, document);
          const textDocuments = Array.from(byPath.values());
          const active = state.tabs.find((tab) => tab.id === state.activeTabId);
          let tabs = state.tabs
            .filter((tab) => tab.location.kind !== "launcher")
            .map(cloneTab)
            .filter((tab) => tab.location.kind !== "text-file" || byPath.has(tab.location.path));

          const firstDocument = incoming[0];
          const nextLocation = textFileLocation(firstDocument);
          let targetTab = active ? tabs.find((tab) => tab.id === active.id) ?? cloneTab(active) : createTextFileTab(firstDocument);
          const previousLocation = options.backLocation ?? targetTab.location;
          targetTab = {
            ...targetTab,
            location: nextLocation,
            back: sameLocation(previousLocation, nextLocation) ? targetTab.back : [...targetTab.back, previousLocation],
            forward: [],
          };
          tabs = tabs.filter((tab) => (
            tab.id !== targetTab.id &&
            (tab.location.kind !== "text-file" || tab.location.path !== firstDocument.path)
          ));
          tabs.push(targetTab);

          const tabByPath = new Map<string, MoleculeTab>();
          for (const tab of tabs) {
            if (tab.location.kind === "text-file") tabByPath.set(tab.location.path, tab);
          }
          tabByPath.set(firstDocument.path, targetTab);

          for (const document of incoming.slice(1)) {
            const existing = tabByPath.get(document.path);
            if (existing) {
              existing.location = textFileLocation(document);
            } else {
              const tab = createTextFileTab(document);
              tabs.push(tab);
              tabByPath.set(document.path, tab);
            }
          }

          const nextTabs = ensureTabs(tabs);
          const activeTabId = activeTabIdOrFirst(nextTabs, targetTab.id);
          return { textDocuments, tabs: nextTabs, activeTabId, activeDocumentId: activeDocumentIdFrom(nextTabs, activeTabId, state.documents) };
        }),
      rememberRecentStructures: (incoming) => {
        const remembered = normalizeGlobalRecentStructures(incoming
          .filter(isPersistentViewerDocument)
          .map(toRecentStructure));
        if (remembered.length === 0) return;
        set((state) => {
          const existing = loadGlobalRecentStructures() ?? state.recentStructures;
          const recentStructures = mergedRecentStructures(existing, remembered);
          saveGlobalRecentStructures(recentStructures);
          return { recentStructures };
        });
        if (isTauriRuntime()) {
          reconcileRecentStructures(invoke("merge_recent_documents", { documents: remembered }));
        }
      },
      pruneRecentStructures: (checkedDocuments, existingPaths) => {
        set((state) => {
          const current = loadGlobalRecentStructures() ?? state.recentStructures;
          const recentStructures = prunedRecentStructures(current, checkedDocuments, existingPaths);
          saveGlobalRecentStructures(recentStructures);
          return recentStructures.length === state.recentStructures.length
            && recentStructures.every((structure, index) => structure.path === state.recentStructures[index]?.path)
            ? state
            : { recentStructures };
        });
        if (isTauriRuntime()) {
          reconcileRecentStructures(invoke("prune_recent_documents", { checkedDocuments, existingPaths }));
        }
      },
      clearRecentStructures: () => {
        saveGlobalRecentStructures([]);
        set({ recentStructures: [] });
        if (isTauriRuntime()) {
          reconcileRecentStructures(invoke("clear_recent_documents"));
        }
      },
      openNewTab: () =>
        set((state) => {
          const tab = createLauncherTab();
          const tabs = [...state.tabs, tab];
          return { tabs, activeTabId: tab.id, activeDocumentId: null };
        }),
      openFepNetworkTab: (location) =>
        set((state) => {
          const existing = state.tabs.find((tab) => tab.location.kind === "fep-network");
          if (existing) {
            const tabs = state.tabs.map((tab) => (tab.id === existing.id ? { ...tab, location } : tab));
            return { tabs, activeTabId: existing.id, activeDocumentId: null };
          }
          const tab = createFepNetworkTab(location);
          const tabs = [...state.tabs.filter((candidate) => candidate.location.kind !== "launcher"), tab];
          return { tabs, activeTabId: tab.id, activeDocumentId: null };
        }),
      openFepSetupTab: (location) =>
        set((state) => {
          const existing = state.tabs.find((tab) => (
            tab.location.kind === "fep-setup" &&
            tab.location.gridPath === location.gridPath &&
            tab.location.dockingPath === location.dockingPath
          ));
          if (existing) {
            const tabs = state.tabs.map((tab) => (tab.id === existing.id ? { ...tab, location } : tab));
            return {
              tabs,
              activeTabId: existing.id,
              activeDocumentId: activeDocumentIdFrom(tabs, existing.id, state.documents),
            };
          }
          const tab = createFepSetupTab(location);
          const tabs = [...state.tabs.filter((candidate) => candidate.location.kind !== "launcher"), tab];
          return { tabs, activeTabId: tab.id, activeDocumentId: activeDocumentIdFrom(tabs, tab.id, state.documents) };
        }),
      openKetcherTab: (location: KetcherLocation = { kind: "ketcher" }) =>
        set((state) => {
          const existing = state.tabs.find((tab) => tab.location.kind === "ketcher");
          if (existing) {
            const existingLocation = existing.location as KetcherLocation;
            const nextLocation: KetcherLocation = { ...existingLocation, ...location, kind: "ketcher" };
            if (!("importRequest" in location)) {
              delete nextLocation.importRequest;
              delete nextLocation.importRequestId;
            }
            const tabs = state.tabs.map((tab) => (tab.id === existing.id
              ? { ...tab, location: nextLocation }
              : tab));
            return { tabs, activeTabId: existing.id, activeDocumentId: null };
          }
          const tab = createKetcherTab(createTabId(), location);
          const tabs = [...state.tabs, tab];
          return { tabs, activeTabId: tab.id, activeDocumentId: null };
        }),
      openPoseReviewTab: (location) =>
        set((state) => {
          const existing = state.tabs.find((tab) => (
            tab.location.kind === "pose-review" &&
            tab.location.gridPath === location.gridPath &&
            tab.location.dockingPath === location.dockingPath
          ));
          if (existing) {
            const tabs = state.tabs.map((tab) => (tab.id === existing.id ? { ...tab, location } : tab));
            return {
              tabs,
              activeTabId: existing.id,
              activeDocumentId: activeDocumentIdFrom(tabs, existing.id, state.documents),
            };
          }
          const tab = createPoseReviewTab(location);
          const tabs = [...state.tabs.filter((candidate) => candidate.location.kind !== "launcher"), tab];
          return { tabs, activeTabId: tab.id, activeDocumentId: activeDocumentIdFrom(tabs, tab.id, state.documents) };
        }),
      openSettingsTab: (section = DEFAULT_SETTINGS_SECTION) =>
        set((state) => {
          const existing = state.tabs.find((tab) => tab.location.kind === "settings");
          if (existing) {
            const tabs = state.tabs.map((tab) => (
              tab.id === existing.id ? { ...tab, location: { kind: "settings" as const, section } } : tab
            ));
            return { tabs, activeTabId: existing.id, activeDocumentId: null };
          }
          const tab = createSettingsTab();
          tab.location = { kind: "settings", section };
          return { tabs: [...state.tabs, tab], activeTabId: tab.id, activeDocumentId: null };
        }),
      openSettingsSection: (section) =>
        set((state) => {
          const existing = state.tabs.find((tab) => tab.location.kind === "settings");
          if (!existing) {
            const tab = createSettingsTab();
            tab.location = { kind: "settings", section };
            return { tabs: [...state.tabs, tab], activeTabId: tab.id, activeDocumentId: null };
          }
          const tabs = state.tabs.map((tab) => (
            tab.id === existing.id ? { ...tab, location: { kind: "settings" as const, section } } : tab
          ));
          return { tabs, activeTabId: existing.id, activeDocumentId: null };
        }),
      activateLastNonSettingsTab: () =>
        set((state) => {
          const target = [...state.tabs].reverse().find((tab) => tab.location.kind !== "settings");
          if (target) {
            return { activeTabId: target.id, activeDocumentId: activeDocumentIdFrom(state.tabs, target.id, state.documents) };
          }
          const tab = createLauncherTab();
          const tabs = [...state.tabs, tab];
          return { tabs, activeTabId: tab.id, activeDocumentId: null };
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
      moveTab: (id, toIndex) =>
        set((state) => {
          const tabs = moveTabToIndex(state.tabs, id, toIndex);
          return tabs === state.tabs ? state : { tabs };
        }),
      closeTab: (id) =>
        set((state) => {
          const closing = state.tabs.find((tab) => tab.id === id);
          let documents = state.documents;
          let textDocuments = state.textDocuments;
          if (closing && closing.location.kind === "file") {
            const path = closing.location.path;
            documents = state.documents.filter((document) => document.path !== path);
          }
          if (closing && closing.location.kind === "text-file") {
            const path = closing.location.path;
            textDocuments = state.textDocuments.filter((document) => document.path !== path);
          }
          const tabs = ensureTabs(state.tabs.filter((tab) => tab.id !== id));
          const activeTabId = activeTabIdOrFirst(tabs, state.activeTabId === id ? null : state.activeTabId);
          return { documents, textDocuments, tabs, activeTabId, activeDocumentId: activeDocumentIdFrom(tabs, activeTabId, documents) };
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
          let textDocuments = state.textDocuments;
          const location = activeTab.location;
          if (location.kind === "file") {
            documents = state.documents.filter((document) => document.path !== location.path);
          }
          if (location.kind === "text-file") {
            textDocuments = state.textDocuments.filter((document) => document.path !== location.path);
          }
          const tabs = ensureTabs(state.tabs.filter((tab) => tab.id !== activeTab.id));
          const activeTabId = activeTabIdOrFirst(tabs, null);
          return { documents, textDocuments, tabs, activeTabId, activeDocumentId: activeDocumentIdFrom(tabs, activeTabId, documents) };
        }),
      closeAllDocuments: () => {
        const tab = createLauncherTab();
        return set({ documents: [], textDocuments: [], tabs: [tab], activeTabId: tab.id, activeDocumentId: null });
      },
      restoreSession: (sessionTabs, activeIndex) =>
        set((state) => {
          const hydratedTabs = ensureTabs(sessionTabs.map((tab) => hydrateTab(tab)).filter((tab): tab is MoleculeTab => tab !== null));
          const requested = activeIndex === null ? null : hydratedTabs[activeIndex]?.id ?? null;
          const tabs = dedupeTabIds(ensureTabs(collapseDuplicateKetcherTabs(hydratedTabs, requested)));
          const activeTabId = activeTabIdOrFirst(tabs, requested);
          return { tabs, activeTabId, activeDocumentId: activeDocumentIdFrom(tabs, activeTabId, state.documents) };
        }),
      restoreSnapshot: (snapshot) =>
        set(() => {
          const documents = cloneJson(snapshot.documents);
          const textDocuments = cloneJson(snapshot.textDocuments);
          const tabs = ensureTabs(cloneJson(snapshot.tabs));
          syncTabSequence(tabs);
          const activeTabId = activeTabIdOrFirst(tabs, snapshot.activeTabId);
          return {
            documents,
            textDocuments,
            tabs,
            activeTabId,
            activeDocumentId: activeDocumentIdFrom(tabs, activeTabId, documents),
            recentStructures: cloneJson(snapshot.recentStructures),
          };
        }),
    }),
    {
      name: workspaceStorageKey("burrete.molecule.session"),
      partialize: (state) => shouldIgnorePersistedSession()
        ? devFilesPersistedSession(state.recentStructures)
        : ({
            documents: [],
            tabs: persistedTabs(collapseDuplicateKetcherTabs(state.tabs, state.activeTabId)),
            activeTabId: state.activeTabId,
            recentStructures: state.recentStructures.filter(isPersistentRecentStructure),
          }),
      merge: (persisted, current) => {
        const stored = persisted as Partial<PersistedMoleculeState> | undefined;
        if (shouldIgnorePersistedSession()) {
          return {
            ...current,
            recentStructures: recentStructuresForMigration(stored?.recentStructures, current.recentStructures),
          };
        }
        const documents = current.documents;
        const storedTabs = (stored?.tabs ?? current.tabs).filter((tab) => (
          tab.location.kind !== "settings" &&
          (
            (tab.location.kind !== "file" && tab.location.kind !== "text-file") ||
            !isTemporaryDocumentPath(tab.location.path)
          )
        ));
        const tabs = collapseDuplicateKetcherTabs(
          dedupeTabIds(ensureTabs(storedTabs.map(cloneTab))),
          stored?.activeTabId ?? current.activeTabId,
        );
        const activeTabId = activeTabIdOrFirst(tabs, stored?.activeTabId ?? current.activeTabId);
        return {
          ...current,
          documents,
          tabs,
          activeTabId,
          activeDocumentId: activeDocumentIdFrom(tabs, activeTabId, documents),
          recentStructures: recentStructuresForMigration(stored?.recentStructures, current.recentStructures),
        };
      },
    },
  ),
);

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  if (isTauriRuntime()) {
    void initializeNativeRecentDocuments();
  }
  window.addEventListener("storage", (event) => {
    if (event.key !== GLOBAL_RECENT_STRUCTURES_STORAGE_KEY) return;
    const recentStructures = loadGlobalRecentStructures();
    if (recentStructures) useMoleculeStore.setState({ recentStructures });
  });
}
