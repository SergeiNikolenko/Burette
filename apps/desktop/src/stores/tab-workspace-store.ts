import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  createDockTab,
  dockTabCatalog,
  ensureDefaultDockTabs,
  firstDockTabKind,
  normalizeDockActiveTab,
  normalizeDockTabs,
  persistentDockTabs,
  type DockArea,
  type DockDropInput,
  type DockDroppedStructure,
  type DockTab,
  type DockTabKind,
  type DockToolKind,
} from "../lib/dock";
import { isTemporaryDocumentPath } from "../lib/temporary-documents";
import { workspaceStorageKey } from "../lib/window-scope";
import { useMoleculeStore } from "./molecule-store";

export type DockAreaWorkspace = {
  open: boolean;
  size: number;
  tabs: DockTab[];
  activeTab: DockTabKind;
  documentId: string | null;
  tool: DockToolKind | null;
};

export type TabWorkspace = {
  right: DockAreaWorkspace;
  bottom: DockAreaWorkspace;
  droppedStructures: DockDroppedStructure[];
};

export type TabWorkspaceSnapshot = {
  workspaces: Record<string, TabWorkspace>;
};

type TabWorkspaceState = TabWorkspaceSnapshot & {
  setDockOpen: (tabId: string, area: DockArea, open: boolean) => void;
  setDockSize: (tabId: string, area: DockArea, size: number) => void;
  toggleDock: (tabId: string, area: DockArea) => void;
  openDockTab: (tabId: string, area: DockArea, kind: DockTabKind) => void;
  closeDockTab: (tabId: string, area: DockArea, dockTabId: string) => void;
  setDockActiveTab: (tabId: string, area: DockArea, kind: DockTabKind) => void;
  setDockDocument: (tabId: string, area: DockArea, documentId: string | null) => void;
  setDockTool: (tabId: string, area: DockArea, tool: DockToolKind | null) => void;
  addDockDrop: (tabId: string, input: DockDropInput) => void;
  pruneWorkspaces: (tabIds: string[]) => void;
  restoreSnapshot: (snapshot: TabWorkspaceSnapshot) => void;
};

const DEFAULT_RIGHT_SIZE = 360;
const DEFAULT_BOTTOM_SIZE = 260;
const MAX_DROPS = 60;

function defaultDockArea(area: DockArea): DockAreaWorkspace {
  return {
    open: false,
    size: area === "right" ? DEFAULT_RIGHT_SIZE : DEFAULT_BOTTOM_SIZE,
    tabs: normalizeDockTabs(area, undefined),
    activeTab: firstDockTabKind(area),
    documentId: null,
    tool: null,
  };
}

export function defaultTabWorkspace(): TabWorkspace {
  return { right: defaultDockArea("right"), bottom: defaultDockArea("bottom"), droppedStructures: [] };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeSize(area: DockArea, size: number) {
  return area === "right"
    ? Math.max(260, Math.min(960, Math.round(size)))
    : Math.max(180, Math.min(720, Math.round(size)));
}

function normalizeArea(area: DockArea, input: Partial<DockAreaWorkspace> | undefined): DockAreaWorkspace {
  const fallback = defaultDockArea(area);
  const normalizedTabs = area === "bottom"
    ? persistentDockTabs(area, input?.tabs)
    : normalizeDockTabs(area, input?.tabs);
  const tabs = input?.open ? ensureDefaultDockTabs(area, normalizedTabs) : normalizedTabs;
  return {
    open: input?.open ?? fallback.open,
    size: normalizeSize(area, input?.size ?? fallback.size),
    tabs,
    activeTab: normalizeDockActiveTab(area, tabs, input?.activeTab ?? fallback.activeTab),
    documentId: typeof input?.documentId === "string" ? input.documentId : null,
    tool: input?.tool === "ketcher" ? input.tool : null,
  };
}

function normalizeWorkspace(input: Partial<TabWorkspace> | undefined): TabWorkspace {
  return {
    right: normalizeArea("right", input?.right),
    bottom: normalizeArea("bottom", input?.bottom),
    droppedStructures: Array.isArray(input?.droppedStructures)
      ? cloneJson(input.droppedStructures).slice(0, MAX_DROPS)
      : [],
  };
}

function updateWorkspace(
  state: TabWorkspaceState,
  tabId: string,
  update: (workspace: TabWorkspace) => TabWorkspace,
) {
  if (!tabId) return state;
  return { workspaces: { ...state.workspaces, [tabId]: update(normalizeWorkspace(state.workspaces[tabId])) } };
}

function dockDropItems(input: DockDropInput): DockDroppedStructure[] {
  const now = Date.now();
  const paths = input.payload.paths.map((path, index) => ({
    id: `${now}-${input.area}-${input.tabKind}-path-${index}-${path}`,
    area: input.area,
    tabKind: input.tabKind,
    title: path.split(/[\\/]/u).pop() || path,
    detail: path,
    addedAt: now + index,
    payload: { paths: [path], records: [] },
  }));
  const records = input.payload.records.map((record, index) => ({
    id: `${now}-${input.area}-${input.tabKind}-record-${index}-${record.path}`,
    area: input.area,
    tabKind: input.tabKind,
    title: record.path,
    detail: `${record.inputExtension.toUpperCase()} inline structure`,
    addedAt: now + paths.length + index,
    payload: { paths: [], records: [record] },
  }));
  const items = (input.payload.items ?? []).map((item, index) => ({
    id: `${now}-${input.area}-${input.tabKind}-item-${index}-${item.kind}-${item.title}`,
    area: input.area,
    tabKind: input.tabKind,
    title: item.title,
    detail: item.detail ?? item.path ?? item.kind,
    addedAt: now + paths.length + records.length + index,
    payload: { paths: item.path ? [item.path] : [], records: [], items: [item] },
  }));
  return [...paths, ...records, ...items];
}

function persistentDrops(drops: DockDroppedStructure[]) {
  return drops.flatMap((drop) => {
    const paths = drop.payload.paths.filter((path) => path && !isTemporaryDocumentPath(path));
    const items = (drop.payload.items ?? []).filter((item) => item.path && !isTemporaryDocumentPath(item.path));
    if (paths.length === 0 && items.length === 0) return [];
    return [{ ...drop, payload: { paths, records: [], ...(items.length ? { items } : {}) } }];
  }).slice(0, MAX_DROPS);
}

function persistentWorkspace(workspace: TabWorkspace): TabWorkspace {
  return {
    right: { ...normalizeArea("right", workspace.right), documentId: null },
    bottom: { ...normalizeArea("bottom", workspace.bottom), documentId: null },
    droppedStructures: persistentDrops(workspace.droppedStructures),
  };
}

function legacyTabWorkspace(): TabWorkspace | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const parsed = JSON.parse(localStorage.getItem("burette.shell.ui") ?? "null") as {
      state?: Record<string, unknown>;
    } | null;
    const state = parsed?.state;
    if (!state) return null;
    return normalizeWorkspace({
      right: {
        open: state.rightDockOpen === true,
        size: typeof state.rightDockWidth === "number" ? state.rightDockWidth : DEFAULT_RIGHT_SIZE,
        tabs: Array.isArray(state.rightDockTabs) ? state.rightDockTabs as DockTab[] : [],
        activeTab: state.rightDockActiveTab as DockTabKind,
        documentId: null,
        tool: null,
      },
      bottom: {
        open: state.bottomDockOpen === true,
        size: typeof state.bottomDockHeight === "number" ? state.bottomDockHeight : DEFAULT_BOTTOM_SIZE,
        tabs: Array.isArray(state.bottomDockTabs) ? state.bottomDockTabs as DockTab[] : [],
        activeTab: state.bottomDockActiveTab as DockTabKind,
        documentId: null,
        tool: null,
      },
      droppedStructures: Array.isArray(state.dockDroppedStructures)
        ? state.dockDroppedStructures as DockDroppedStructure[]
        : [],
    });
  } catch {
    return null;
  }
}

export function getTabWorkspace(tabId: string | null | undefined) {
  if (!tabId) return defaultTabWorkspace();
  return normalizeWorkspace(useTabWorkspaceStore.getState().workspaces[tabId]);
}

export function getTabWorkspaceStoreSnapshot(): TabWorkspaceSnapshot {
  return cloneJson({
    workspaces: Object.fromEntries(
      Object.entries(useTabWorkspaceStore.getState().workspaces)
        .map(([tabId, workspace]) => [tabId, persistentWorkspace(workspace)]),
    ),
  });
}

export const useTabWorkspaceStore = create<TabWorkspaceState>()(
  persist<TabWorkspaceState, [], [], TabWorkspaceSnapshot>(
    (set) => ({
      workspaces: {},
      setDockOpen: (tabId, area, open) => set((state) => updateWorkspace(state, tabId, (workspace) => ({
        ...workspace,
        [area]: {
          ...workspace[area],
          open,
          ...(open ? { tabs: ensureDefaultDockTabs(area, workspace[area].tabs) } : {}),
        },
      }))),
      setDockSize: (tabId, area, size) => set((state) => updateWorkspace(state, tabId, (workspace) => ({
        ...workspace,
        [area]: { ...workspace[area], size: normalizeSize(area, size) },
      }))),
      toggleDock: (tabId, area) => set((state) => updateWorkspace(state, tabId, (workspace) => ({
        ...workspace,
        [area]: {
          ...workspace[area],
          open: !workspace[area].open,
          ...(!workspace[area].open ? { tabs: ensureDefaultDockTabs(area, workspace[area].tabs) } : {}),
        },
      }))),
      openDockTab: (tabId, area, kind) => set((state) => {
        if (!dockTabCatalog(area).includes(kind)) return state;
        return updateWorkspace(state, tabId, (workspace) => {
          const current = workspace[area];
          const tabs = current.tabs.some((tab) => tab.kind === kind) ? current.tabs : [...current.tabs, createDockTab(kind)];
          return { ...workspace, [area]: { ...current, open: true, tabs, activeTab: kind } };
        });
      }),
      closeDockTab: (tabId, area, dockTabId) => set((state) => updateWorkspace(state, tabId, (workspace) => {
        const current = workspace[area];
        const tabs = normalizeDockTabs(area, current.tabs.filter((tab) => tab.id !== dockTabId));
        return { ...workspace, [area]: { ...current, tabs, activeTab: normalizeDockActiveTab(area, tabs, current.activeTab) } };
      })),
      setDockActiveTab: (tabId, area, kind) => set((state) => updateWorkspace(state, tabId, (workspace) => {
        const current = workspace[area];
        return current.tabs.some((tab) => tab.kind === kind)
          ? { ...workspace, [area]: { ...current, activeTab: kind } }
          : workspace;
      })),
      setDockDocument: (tabId, area, documentId) => set((state) => updateWorkspace(state, tabId, (workspace) => ({
        ...workspace,
        [area]: {
          ...workspace[area],
          open: true,
          tabs: ensureDefaultDockTabs(area, workspace[area].tabs),
          documentId,
          tool: null,
          activeTab: "files",
        },
      }))),
      setDockTool: (tabId, area, tool) => set((state) => updateWorkspace(state, tabId, (workspace) => ({
        ...workspace,
        [area]: {
          ...workspace[area],
          open: true,
          tabs: ensureDefaultDockTabs(area, workspace[area].tabs),
          documentId: null,
          tool,
          activeTab: "files",
        },
      }))),
      addDockDrop: (tabId, input) => set((state) => {
        if (!dockTabCatalog(input.area).includes(input.tabKind)) return state;
        const items = dockDropItems(input);
        if (items.length === 0) return state;
        return updateWorkspace(state, tabId, (workspace) => {
          const current = workspace[input.area];
          const tabs = current.tabs.some((tab) => tab.kind === input.tabKind)
            ? current.tabs
            : [...current.tabs, createDockTab(input.tabKind)];
          return {
            ...workspace,
            [input.area]: { ...current, open: true, tabs, activeTab: input.tabKind },
            droppedStructures: [...items, ...workspace.droppedStructures].slice(0, MAX_DROPS),
          };
        });
      }),
      pruneWorkspaces: (tabIds) => set((state) => {
        const live = new Set(tabIds);
        const workspaces = Object.fromEntries(Object.entries(state.workspaces).filter(([tabId]) => live.has(tabId)));
        return Object.keys(workspaces).length === Object.keys(state.workspaces).length ? state : { workspaces };
      }),
      restoreSnapshot: (snapshot) => set({ workspaces: cloneJson(snapshot.workspaces) }),
    }),
    {
      name: workspaceStorageKey("burette.tab-workspaces"),
      version: 1,
      partialize: (state) => ({
        workspaces: Object.fromEntries(
          Object.entries(state.workspaces).map(([tabId, workspace]) => [tabId, persistentWorkspace(workspace)]),
        ),
      }),
      merge: (persisted, current) => {
        const stored = persisted as Partial<TabWorkspaceSnapshot> | undefined;
        const workspaces = Object.fromEntries(
          Object.entries(stored?.workspaces ?? {}).map(([tabId, workspace]) => [tabId, normalizeWorkspace(workspace)]),
        );
        if (persisted === undefined) {
          const activeTabId = useMoleculeStore.getState().activeTabId;
          const legacy = legacyTabWorkspace();
          if (activeTabId && legacy) workspaces[activeTabId] = legacy;
        }
        return {
          ...current,
          workspaces,
        };
      },
    },
  ),
);

let previousTabIds = useMoleculeStore.getState().tabs.map((tab) => tab.id);

useMoleculeStore.subscribe((state) => {
  const tabIds = state.tabs.map((tab) => tab.id);
  if (tabIds.length === previousTabIds.length && tabIds.every((tabId, index) => tabId === previousTabIds[index])) {
    return;
  }
  previousTabIds = tabIds;
  useTabWorkspaceStore.getState().pruneWorkspaces(tabIds);
});

useTabWorkspaceStore.getState().pruneWorkspaces(previousTabIds);
