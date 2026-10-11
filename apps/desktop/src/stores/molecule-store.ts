import { moveTabHistory } from "../lib/tab-navigation";
import { rememberClosedTab } from "./closed-tabs";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  deserializeLocation,
  serializeLocation,
  type DocumentLocation,
  type FepNetworkLocation,
  type FepSetupLocation,
  type KetcherLocation,
  type Location,
  type PoseReviewLocation,
  type SerializedLocation,
  type TextFileLocation,
} from "../components/editor-area/page-kinds";
import { DEFAULT_SETTINGS_SECTION, type AppSettingsSectionId } from "../lib/settings-sections";
import { pathExtension } from "../lib/file-routing";
import { basename } from "../lib/sidebar-projects";
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
import { useSettingsStore } from "./settings-store";

// Where a screen is shown when it is not in the main tab strip: the right side
// panel or the floating window. A tab without a pane lives in the main strip.
export type TabPane = "side" | "floating";

export type MoleculeTab = {
  pinned?: boolean;
  pane?: TabPane;
  id: string;
  location: Location;
  back: Location[];
  forward: Location[];
};

export type SessionTab = {
  pinned?: boolean;
  pane?: TabPane;
  id?: string;
  location: SerializedLocation;
  back: SerializedLocation[];
  forward: SerializedLocation[];
};

type MoleculeState = {
  settingsReturnTabId: string | null;
  documents: ViewerDocument[];
  textDocuments: TextFileDocument[];
  tabs: MoleculeTab[];
  activeTabId: string | null;
  activeDocumentId: string | null;
  sidePaneTabId: string | null;
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
  openDocumentTab: (path: string) => void;
  openKetcherTab: (location?: KetcherLocation) => void;
  openPoseReviewTab: (location: PoseReviewLocation) => void;
  openSettingsTab: (section?: AppSettingsSectionId) => void;
  openSettingsSection: (section: AppSettingsSectionId) => void;
  activateLastNonSettingsTab: () => void;
  navigateTabLocation: (tabId: string, location: Location, mode: "push" | "replace") => void;
  navigateTabHistory: (tabId: string, delta: number) => void;
  navigateBack: () => void;
  navigateForward: () => void;
  setActiveTab: (id: string) => void;
  setActiveDocument: (id: string) => void;
  moveTab: (id: string, toIndex: number) => void;
  placeTab: (id: string, pane: TabPane | null) => void;
  openScreenTab: (location: Location, pane?: TabPane | null) => void;
  showSidePaneTab: (id: string) => void;
  togglePinnedTab: (id: string) => void;
  closeTab: (id: string) => void;
  closeDocument: (id: string) => void;
  closeActiveDocument: () => void;
  closeAllDocuments: () => void;
  pruneMissingFileTabs: (checkedPaths: string[], existingPaths: string[]) => void;
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
> & { sidePaneTabId?: string | null };

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

export function createDocumentTab(location: DocumentLocation, id = createTabId()): MoleculeTab {
  return { id, location, back: [], forward: [] };
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
  if (left.kind === "chemical-space" && right.kind === "chemical-space") return left.collectionPath === right.collectionPath;
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
    tab.location.kind !== "fep-setup" &&
    tab.location.kind !== "fep-network" &&
    tab.location.kind !== "pose-review" &&
    (
      (tab.location.kind !== "file" && tab.location.kind !== "text-file") ||
      !isTemporaryDocumentPath(tab.location.path)
    )
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

function settingsReturnTabId(state: MoleculeState) {
  const active = state.tabs.find((tab) => tab.id === state.activeTabId);
  return active && active.location.kind !== "settings" ? active.id : state.settingsReturnTabId;
}

// A tab shown in the main strip: Settings is a separate full-window mode and
// placed tabs live in the side panel or the floating window.
export function isMainTab(tab: MoleculeTab) {
  return tab.location.kind !== "settings" && !tab.pane;
}

function activeTabIdOrFirst(tabs: MoleculeTab[], activeTabId: string | null) {
  // An explicitly requested placed tab is kept: the store moves it back to
  // the strip right after (see the subscription at the end of this module).
  if (activeTabId && tabs.some((tab) => tab.id === activeTabId)) return activeTabId;
  // Settings is hidden from the tab strip and is only selected explicitly.
  return tabs.find(isMainTab)?.id ?? null;
}

// Opening a document replaces the start page, but a start page parked in the
// side panel or the floating window is a screen the user placed there.
function retainedOnOpen(tab: MoleculeTab) {
  return tab.location.kind !== "launcher" || Boolean(tab.pane);
}

function withPane(tab: MoleculeTab, pane: TabPane | null): MoleculeTab {
  if (pane) return { ...tab, pane };
  const { pane: _previous, ...rest } = tab;
  return rest;
}

// The main tab that takes over when the active one leaves the strip: the next
// one to its right, else the one to its left.
function neighborMainTabId(tabs: MoleculeTab[], id: string) {
  const strip = tabs.filter((tab) => isMainTab(tab) || tab.id === id);
  const index = strip.findIndex((tab) => tab.id === id);
  return strip[index + 1]?.id ?? strip[index - 1]?.id ?? null;
}

function isTabPane(value: unknown): value is TabPane {
  return value === "side" || value === "floating";
}

function moveTabToIndex(tabs: MoleculeTab[], id: string, toIndex: number) {
  const fromIndex = tabs.findIndex((tab) => tab.id === id);
  if (fromIndex < 0) return tabs;
  const pinnedCount = tabs.filter(tab => tab.pinned).length;
  const lower = tabs[fromIndex].pinned ? 0 : pinnedCount;
  const upper = tabs[fromIndex].pinned ? pinnedCount - 1 : tabs.length - 1;
  const nextIndex = Math.max(lower, Math.min(upper, Math.round(toIndex)));
  if (fromIndex === nextIndex) return tabs;
  const nextTabs = [...tabs];
  const [tab] = nextTabs.splice(fromIndex, 1);
  nextTabs.splice(nextIndex, 0, tab);
  return nextTabs;
}

function ensureTabs(tabs: MoleculeTab[]) {
  const next = [...tabs];
  // A retained Settings page does not count as an open workspace tab, and
  // neither does a placed one: the main strip always shows at least one tab.
  if (!next.some(isMainTab)
    && !(typeof window !== "undefined" && window.BuretteMcpWorkspace)) {
    next.push(createLauncherTab());
  }
  return next.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
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
    id: tab.id,
    ...(tab.pinned ? { pinned: true } : {}),
    ...(tab.pane ? { pane: tab.pane } : {}),
    location,
    back: tab.back.map(serializeLocation).filter((location): location is SerializedLocation => location !== null),
    forward: tab.forward.map(serializeLocation).filter((location): location is SerializedLocation => location !== null),
  };
}

function hydrateTab(tab: SessionTab, id = tab.id ?? createTabId()): MoleculeTab | null {
  const location = deserializeLocation(tab.location);
  if (!location) return null;
  return {
    id,
    ...(tab.pinned ? { pinned: true } : {}),
    ...(isTabPane(tab.pane) ? { pane: tab.pane } : {}),
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
  if (window.BuretteMcpWorkspace) return false;
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
  const activeIndex = state.activeTabId ? tabs.findIndex((tab) => tab.id === state.activeTabId) : null;
  return { tabs, activeIndex: activeIndex !== null && activeIndex >= 0 ? activeIndex : null };
}

export function getMoleculeStoreSnapshot(): MoleculeStoreSnapshot {
  const state = useMoleculeStore.getState();
  const snapshot = cloneJson({
    documents: state.documents,
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    activeDocumentId: state.activeDocumentId,
    recentStructures: state.recentStructures,
  });
  // Store updates replace document records. Keep their immutable content shared
  // across navigation history rather than serializing every open file.
  return { ...snapshot, textDocuments: [...state.textDocuments] };
}

export const useMoleculeStore = create<MoleculeState>()(
  persist<MoleculeState, [], [], PersistedMoleculeState>(
    (set, get) => ({
      settingsReturnTabId: null,
      documents: [],
      textDocuments: [],
      tabs: [createLauncherTab()],
      activeTabId: "tab-1",
      activeDocumentId: null,
      sidePaneTabId: null,
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
            .filter(retainedOnOpen)
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
          const active = state.tabs.find((tab) => tab.id === state.activeTabId && !tab.pinned);
          let tabs = state.tabs
            .filter(retainedOnOpen)
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
            .filter(retainedOnOpen)
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
          const active = state.tabs.find((tab) => tab.id === state.activeTabId && !tab.pinned);
          let tabs = state.tabs
            .filter(retainedOnOpen)
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
          const tabs = [...state.tabs.filter(retainedOnOpen), tab];
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
          const tabs = [...state.tabs.filter(retainedOnOpen), tab];
          return { tabs, activeTabId: tab.id, activeDocumentId: activeDocumentIdFrom(tabs, tab.id, state.documents) };
        }),
      openDocumentTab: (path) => {
        set((state) => {
          const existing = state.tabs.find((tab) => tab.location.kind === "document" && tab.location.path === path);
          if (existing) return { activeTabId: existing.id, activeDocumentId: null };
          const tab = createDocumentTab({ kind: "document", path });
          const tabs = [...state.tabs.filter(retainedOnOpen), tab];
          return { tabs, activeTabId: tab.id, activeDocumentId: null };
        });
        if (isTemporaryDocumentPath(path)) return;
        const remembered = normalizeGlobalRecentStructures([{
          path,
          title: basename(path),
          extension: pathExtension(path),
          renderer: "document",
          byteCount: 0,
          openedAt: Date.now(),
        }]);
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
      openKetcherTab: (location: KetcherLocation = { kind: "ketcher" }) =>
        set((state) => {
          const existing = state.tabs.find((tab) => tab.location.kind === "ketcher");
          if (existing) {
            const existingLocation = existing.location as KetcherLocation;
            const nextLocation: KetcherLocation = { ...existingLocation, ...location, kind: "ketcher" };
            if ("draftMolfile" in location && !("draftKet" in location)) {
              delete nextLocation.draftKet;
            }
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
          const tabs = [...state.tabs.filter(retainedOnOpen), tab];
          return { tabs, activeTabId: tab.id, activeDocumentId: activeDocumentIdFrom(tabs, tab.id, state.documents) };
        }),
      openSettingsTab: (section = DEFAULT_SETTINGS_SECTION) =>
        set((state) => {
          const existing = state.tabs.find((tab) => tab.location.kind === "settings");
          if (existing) {
            const tabs = state.tabs.map((tab) => (
              tab.id === existing.id ? { ...tab, location: { kind: "settings" as const, section } } : tab
            ));
            return { tabs, activeTabId: existing.id, activeDocumentId: null, settingsReturnTabId: settingsReturnTabId(state) };
          }
          const tab = createSettingsTab();
          tab.location = { kind: "settings", section };
          return { tabs: [...state.tabs, tab], activeTabId: tab.id, activeDocumentId: null, settingsReturnTabId: settingsReturnTabId(state) };
        }),
      openSettingsSection: (section) =>
        set((state) => {
          const existing = state.tabs.find((tab) => tab.location.kind === "settings");
          if (!existing) {
            const tab = createSettingsTab();
            tab.location = { kind: "settings", section };
            return { tabs: [...state.tabs, tab], activeTabId: tab.id, activeDocumentId: null, settingsReturnTabId: settingsReturnTabId(state) };
          }
          const tabs = state.tabs.map((tab) => (
            tab.id === existing.id ? { ...tab, location: { kind: "settings" as const, section } } : tab
          ));
          return { tabs, activeTabId: existing.id, activeDocumentId: null, settingsReturnTabId: settingsReturnTabId(state) };
        }),
      activateLastNonSettingsTab: () =>
        set((state) => {
          const target = state.tabs.find((tab) => tab.id === state.settingsReturnTabId && isMainTab(tab))
            ?? [...state.tabs].reverse().find(isMainTab);
          if (target) {
            return { activeTabId: target.id, activeDocumentId: activeDocumentIdFrom(state.tabs, target.id, state.documents) };
          }
          const tab = createLauncherTab();
          const tabs = [...state.tabs, tab];
          return { tabs, activeTabId: tab.id, activeDocumentId: null };
        }),
      navigateTabLocation: (tabId, location, mode) =>
        set((state) => {
          if (!state.tabs.some(tab => tab.id === tabId)) return state;
          const tabs = state.tabs.map(tab => tab.id !== tabId ? tab : {
            ...tab,
            location,
            back: mode === "push" ? [...tab.back, tab.location] : tab.back,
            forward: mode === "push" ? [] : tab.forward,
          });
          return { tabs, activeDocumentId: activeDocumentIdFrom(tabs, state.activeTabId, state.documents) };
        }),
      navigateTabHistory: (tabId, delta) =>
        set((state) => {
          const active = state.tabs.find(tab => tab.id === tabId);
          if (!active) return state;
          const moved = moveTabHistory(active, delta);
          if (moved === active) return state;
          const tabs = state.tabs.map(tab => tab.id === tabId ? moved : tab);
          return { tabs, activeDocumentId: activeDocumentIdFrom(tabs, state.activeTabId, state.documents) };
        }),
      navigateBack: () => {
        const { activeTabId, navigateTabHistory } = useMoleculeStore.getState();
        if (activeTabId) navigateTabHistory(activeTabId, -1);
      },
      navigateForward: () => {
        const { activeTabId, navigateTabHistory } = useMoleculeStore.getState();
        if (activeTabId) navigateTabHistory(activeTabId, 1);
      },
      setActiveTab: (id) =>
        set((state) => {
          const activeTabId = activeTabIdOrFirst(state.tabs, id);
          return {
            activeTabId,
            activeDocumentId: activeDocumentIdFrom(state.tabs, activeTabId, state.documents),
            settingsReturnTabId: state.tabs.find((tab) => tab.id === activeTabId)?.location.kind === "settings"
              ? settingsReturnTabId(state)
              : state.settingsReturnTabId,
          };
        }),
      setActiveDocument: (id) =>
        set((state) => {
          const document = state.documents.find((candidate) => candidate.id === id);
          if (!document) {
            const textDocument = state.textDocuments.find((candidate) => candidate.id === id);
            if (!textDocument) return state;
            const existing = state.tabs.find((tab) => tab.location.kind === "text-file"
              && (tab.location.documentId === id || tab.location.path === textDocument.path));
            const tab = existing ?? createTextFileTab(textDocument);
            return {
              tabs: existing ? state.tabs : [...state.tabs, tab],
              activeTabId: tab.id,
              activeDocumentId: null,
            };
          }
          const existing = state.tabs.find((tab) => tab.location.kind === "file" && (tab.location.documentId === id || tab.location.path === document.path));
          if (existing) {
            return { activeTabId: existing.id, activeDocumentId: document.id };
          }
          const tab = createFileTab(document);
          return { tabs: [...state.tabs, tab], activeTabId: tab.id, activeDocumentId: document.id };
        }),
      togglePinnedTab: (id) => set(state => ({
        tabs: state.tabs.map(tab => tab.id === id ? { ...tab, pinned: !tab.pinned } : tab)
          .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))),
      })),
      moveTab: (id, toIndex) =>
        set((state) => {
          const tabs = moveTabToIndex(state.tabs, id, toIndex);
          return tabs === state.tabs ? state : { tabs };
        }),
      placeTab: (id, pane) =>
        set((state) => {
          const target = state.tabs.find((tab) => tab.id === id);
          if (!target || target.location.kind === "settings") return state;
          if ((target.pane ?? null) === pane) {
            if (pane === "side") return { sidePaneTabId: id };
            return pane === null ? { activeTabId: id, activeDocumentId: activeDocumentIdFrom(state.tabs, id, state.documents) } : state;
          }
          const successor = state.activeTabId === id ? neighborMainTabId(state.tabs, id) : state.activeTabId;
          // One floating window: the screen it showed returns to the strip.
          const tabs = ensureTabs(state.tabs.map((tab) => (
            tab.id === id ? withPane(tab, pane)
              : pane === "floating" && tab.pane === "floating" ? withPane(tab, null)
                : tab
          )));
          const activeTabId = activeTabIdOrFirst(tabs, pane === null ? id : successor);
          return {
            tabs,
            activeTabId,
            activeDocumentId: activeDocumentIdFrom(tabs, activeTabId, state.documents),
            sidePaneTabId: pane === "side" ? id : state.sidePaneTabId,
          };
        }),
      // Opens a screen that is not a file (Jobs, Chemical Space...) or brings
      // the open one forward, optionally straight into a secondary pane.
      openScreenTab: (location, pane = null) => {
        const existing = get().tabs.find((tab) => tab.location.kind !== "settings" && sameLocation(tab.location, location));
        const tab = existing ?? { id: createTabId(), location, back: [], forward: [] };
        if (!existing) set((state) => ({ tabs: [...(pane ? state.tabs : state.tabs.filter(retainedOnOpen)), tab] }));
        get().placeTab(tab.id, pane);
      },
      showSidePaneTab: (id) =>
        set((state) => (state.tabs.some((tab) => tab.id === id && tab.pane === "side") ? { sidePaneTabId: id } : state)),
      closeTab: (id) =>
        set((state) => {
          const closing = state.tabs.find((tab) => tab.id === id);
          rememberClosedTab(closing);
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
          rememberClosedTab(activeTab);
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
      pruneMissingFileTabs: (checkedPaths, existingPaths) =>
        set((state) => {
          const checked = new Set(checkedPaths);
          const existing = new Set(existingPaths);
          const tabs = ensureTabs(state.tabs.filter((tab) => (
            (tab.location.kind !== "file" && tab.location.kind !== "text-file")
            || !checked.has(tab.location.path)
            || existing.has(tab.location.path)
          )));
          const activeTabId = activeTabIdOrFirst(tabs, state.activeTabId);
          return {
            tabs,
            activeTabId,
            activeDocumentId: activeDocumentIdFrom(tabs, activeTabId, state.documents),
          };
        }),
      restoreSession: (sessionTabs, activeIndex) =>
        set((state) => {
          // activeIndex belongs to the incoming session, before invalid views
          // are removed or pinned tabs are moved to the beginning.
          const hydratedTabs = sessionTabs.map((tab) => hydrateTab(tab));
          const requested = activeIndex === null ? null : hydratedTabs[activeIndex]?.id ?? null;
          const validTabs = hydratedTabs.filter((tab): tab is MoleculeTab => tab !== null);
          const tabs = dedupeTabIds(ensureTabs(collapseDuplicateKetcherTabs(validTabs, requested)));
          const activeTabId = activeTabIdOrFirst(tabs, requested);
          return { tabs, activeTabId, activeDocumentId: activeDocumentIdFrom(tabs, activeTabId, state.documents) };
        }),
      restoreSnapshot: (snapshot) =>
        set(() => {
          const documents = cloneJson(snapshot.documents);
          const textDocuments = snapshot.textDocuments.map((document) => ({ ...document }));
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
      name: workspaceStorageKey("burette.molecule.session"),
      storage: createJSONStorage(() => window.BuretteMcpWorkspace?.storage ?? localStorage),
      partialize: (state) => shouldIgnorePersistedSession()
        ? devFilesPersistedSession(state.recentStructures)
        : ({
            documents: [],
            tabs: persistedTabs(collapseDuplicateKetcherTabs(state.tabs, state.activeTabId)),
            activeTabId: state.activeTabId,
            sidePaneTabId: state.sidePaneTabId,
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
        // "Restore windows and tabs on launch": when it is off, every launch
        // starts from a fresh start page instead of the saved strip and panes.
        const restoreTabs = Boolean(window.BuretteMcpWorkspace)
          || useSettingsStore.getState().preferences.restoreSessionOnLaunch !== false;
        const storedTabs = ((restoreTabs ? stored?.tabs : undefined) ?? current.tabs).filter((tab) => (
          tab.location.kind !== "settings" &&
          (
            (tab.location.kind !== "file" && tab.location.kind !== "text-file") ||
            !isTemporaryDocumentPath(tab.location.path)
          )
        ));
        const storedActiveTabId = restoreTabs ? stored?.activeTabId : undefined;
        const tabs = collapseDuplicateKetcherTabs(
          dedupeTabIds(ensureTabs(storedTabs.map((tab) => withPane(cloneTab(tab), isTabPane(tab.pane) ? tab.pane : null)))),
          storedActiveTabId ?? current.activeTabId,
        );
        const activeTabId = activeTabIdOrFirst(tabs, storedActiveTabId ?? current.activeTabId);
        return {
          ...current,
          documents,
          tabs,
          activeTabId,
          sidePaneTabId: restoreTabs && typeof stored?.sidePaneTabId === "string" ? stored.sidePaneTabId : null,
          activeDocumentId: activeDocumentIdFrom(tabs, activeTabId, documents),
          recentStructures: recentStructuresForMigration(stored?.recentStructures, current.recentStructures),
        };
      },
    },
  ),
);

// Opening or selecting a screen that is parked in the side panel or the
// floating window (from the sidebar, a menu, a deep link...) brings it back to
// the main strip: every action that activates a tab goes through here, so the
// rule needs no copy in each of them.
useMoleculeStore.subscribe((state) => {
  const active = state.tabs.find((tab) => tab.id === state.activeTabId);
  if (!active?.pane) return;
  useMoleculeStore.setState({ tabs: state.tabs.map((tab) => (tab.id === active.id ? withPane(tab, null) : tab)) });
});

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
