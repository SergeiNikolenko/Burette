import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  type DockArea,
  type DockDropInput,
  type DockDroppedStructure,
  type DockTab,
  type DockTabKind,
  type DockToolKind,
  createDockTab,
  dockTabCatalog,
  ensureDefaultDockTabs,
  firstDockTabKind,
  normalizeDockActiveTab,
  normalizeDockTabs,
  persistentDockTabs,
} from "../lib/dock";
import { isTemporaryDocumentPath } from "../lib/temporary-documents";
import { workspaceStorageKey } from "../lib/window-scope";

type ShellState = {
  sidebarOpen: boolean;
  sidebarWidth: number;
  rightDockOpen: boolean;
  rightDockWidth: number;
  rightDockTabs: DockTab[];
  rightDockActiveTab: DockTabKind;
  rightDockDocumentId: string | null;
  rightDockTool: DockToolKind | null;
  bottomDockOpen: boolean;
  bottomDockHeight: number;
  bottomDockTabs: DockTab[];
  bottomDockActiveTab: DockTabKind;
  bottomDockDocumentId: string | null;
  bottomDockTool: DockToolKind | null;
  dockDroppedStructures: DockDroppedStructure[];
  projectsOpen: boolean;
  projectRoots: string[];
  pinnedProjectRoots: string[];
  projectNameOverrides: Record<string, string>;
  expandedProjectIds: string[];
  hiddenProjectRoots: string[];
  pinnedStructurePaths: string[];
  sidebarQuery: string;
  toggleSidebar: () => void;
  closeSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  toggleDock: (area: DockArea) => void;
  setDockOpen: (area: DockArea, open: boolean) => void;
  setDockSize: (area: DockArea, size: number) => void;
  openDockTab: (area: DockArea, kind: DockTabKind) => void;
  closeDockTab: (area: DockArea, tabId: string) => void;
  setDockActiveTab: (area: DockArea, kind: DockTabKind) => void;
  setDockDocument: (area: DockArea, documentId: string | null) => void;
  setDockTool: (area: DockArea, tool: DockToolKind | null) => void;
  addDockDrop: (input: DockDropInput) => void;
  toggleProjectsOpen: () => void;
  setExpandedProjectIds: (projectIds: string[]) => void;
  addProjectRoot: (root: string) => void;
  togglePinnedProjectRoot: (root: string) => void;
  renameProjectRoot: (root: string, name: string) => void;
  removeProjectRoot: (root: string) => void;
  togglePinnedStructure: (path: string) => void;
  pruneSidebarPaths: (existingPaths: string[]) => void;
  setSidebarQuery: (query: string) => void;
  toggleProjectExpanded: (projectId: string) => void;
  restoreSnapshot: (snapshot: ShellStoreSnapshot) => void;
};

export type ShellStoreSnapshot = {
  sidebarOpen: boolean;
  sidebarWidth: number;
  rightDockOpen: boolean;
  rightDockWidth: number;
  rightDockTabs: DockTab[];
  rightDockActiveTab: DockTabKind;
  rightDockDocumentId: string | null;
  rightDockTool: DockToolKind | null;
  bottomDockOpen: boolean;
  bottomDockHeight: number;
  bottomDockTabs: DockTab[];
  bottomDockActiveTab: DockTabKind;
  bottomDockDocumentId: string | null;
  bottomDockTool: DockToolKind | null;
  dockDroppedStructures: DockDroppedStructure[];
  projectsOpen: boolean;
  projectRoots: string[];
  pinnedProjectRoots: string[];
  projectNameOverrides: Record<string, string>;
  expandedProjectIds: string[];
  hiddenProjectRoots: string[];
  pinnedStructurePaths: string[];
};

type PersistedShellState = Pick<
  ShellState,
  | "sidebarOpen"
  | "sidebarWidth"
  | "rightDockOpen"
  | "rightDockWidth"
  | "rightDockTabs"
  | "rightDockActiveTab"
  | "bottomDockOpen"
  | "bottomDockHeight"
  | "bottomDockTabs"
  | "bottomDockActiveTab"
  | "projectsOpen"
  | "projectRoots"
  | "pinnedProjectRoots"
  | "projectNameOverrides"
  | "expandedProjectIds"
  | "hiddenProjectRoots"
  | "pinnedStructurePaths"
>;

function normalizeRoot(root: string) {
  return root.replace(/\\/g, "/").replace(/\/+$/g, "");
}

function isPathAtOrUnder(path: string, root: string) {
  return path === root || path.startsWith(`${root}/`);
}

function persistentRoots(roots: string[]) {
  return roots.map(normalizeRoot).filter((root) => root && !isTemporaryDocumentPath(root));
}

function persistentPinnedPaths(paths: string[]) {
  return paths.map(normalizeRoot).filter((path) => path && !isTemporaryDocumentPath(path));
}

function persistentProjectNameOverrides(overrides: Record<string, string>, projectRoots: string[]) {
  const allowed = new Set(projectRoots);
  return Object.fromEntries(
    Object.entries(overrides)
      .map(([root, name]) => [normalizeRoot(root), name.trim()] as const)
      .filter(([root, name]) => allowed.has(root) && name.length > 0),
  );
}

function persistentExpandedProjectIds(projectIds: string[], projectRoots: string[]) {
  const allowed = new Set(projectRoots.map((root) => `project:${root}`));
  return projectIds.filter((projectId) => !projectId.startsWith("project:") || allowed.has(projectId));
}

function normalizeSidebarWidth(width: number) {
  return Math.max(220, Math.min(420, Math.round(width)));
}

function normalizeRightDockWidth(width: number) {
  return Math.max(260, Math.min(960, Math.round(width)));
}

function normalizeBottomDockHeight(height: number) {
  return Math.max(180, Math.min(720, Math.round(height)));
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function dockTabState(area: DockArea, state: ShellState) {
  return area === "right"
    ? { tabs: state.rightDockTabs, activeTab: state.rightDockActiveTab }
    : { tabs: state.bottomDockTabs, activeTab: state.bottomDockActiveTab };
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

export function getShellStoreSnapshot(): ShellStoreSnapshot {
  const state = useShellStore.getState();
  return cloneJson({
    sidebarOpen: state.sidebarOpen,
    sidebarWidth: state.sidebarWidth,
    rightDockOpen: state.rightDockOpen,
    rightDockWidth: state.rightDockWidth,
    rightDockTabs: state.rightDockTabs,
    rightDockActiveTab: state.rightDockActiveTab,
    rightDockDocumentId: state.rightDockDocumentId,
    rightDockTool: state.rightDockTool,
    bottomDockOpen: state.bottomDockOpen,
    bottomDockHeight: state.bottomDockHeight,
    bottomDockTabs: state.bottomDockTabs,
    bottomDockActiveTab: state.bottomDockActiveTab,
    bottomDockDocumentId: state.bottomDockDocumentId,
    bottomDockTool: state.bottomDockTool,
    dockDroppedStructures: state.dockDroppedStructures,
    projectsOpen: state.projectsOpen,
    projectRoots: state.projectRoots,
    pinnedProjectRoots: state.pinnedProjectRoots,
    projectNameOverrides: state.projectNameOverrides,
    expandedProjectIds: state.expandedProjectIds,
    hiddenProjectRoots: state.hiddenProjectRoots,
    pinnedStructurePaths: state.pinnedStructurePaths,
  });
}

export const useShellStore = create<ShellState>()(
  persist<ShellState, [], [], PersistedShellState>(
    (set) => ({
      sidebarOpen: true,
      sidebarWidth: 240,
      rightDockOpen: true,
      rightDockWidth: 360,
      rightDockTabs: normalizeDockTabs("right", undefined),
      rightDockActiveTab: firstDockTabKind("right"),
      rightDockDocumentId: null,
      rightDockTool: null,
      bottomDockOpen: false,
      bottomDockHeight: 260,
      bottomDockTabs: normalizeDockTabs("bottom", undefined),
      bottomDockActiveTab: firstDockTabKind("bottom"),
      bottomDockDocumentId: null,
      bottomDockTool: null,
      dockDroppedStructures: [],
      projectsOpen: true,
      projectRoots: [],
      pinnedProjectRoots: [],
      projectNameOverrides: {},
      expandedProjectIds: [],
      hiddenProjectRoots: [],
      pinnedStructurePaths: [],
      sidebarQuery: "",
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      closeSidebar: () => set({ sidebarOpen: false }),
      setSidebarWidth: (width) => set({ sidebarWidth: normalizeSidebarWidth(width) }),
      toggleDock: (area) => set((state) => (
        area === "right"
          ? {
              rightDockOpen: !state.rightDockOpen,
              ...(state.rightDockOpen ? {} : {
                rightDockTabs: ensureDefaultDockTabs("right", state.rightDockTabs),
              }),
            }
          : {
              bottomDockOpen: !state.bottomDockOpen,
              ...(state.bottomDockOpen ? {} : {
                bottomDockTabs: ensureDefaultDockTabs("bottom", state.bottomDockTabs),
              }),
            }
      )),
      setDockOpen: (area, open) => set((state) => area === "right"
        ? {
            rightDockOpen: open,
            ...(open ? { rightDockTabs: ensureDefaultDockTabs("right", state.rightDockTabs) } : {}),
          }
        : {
            bottomDockOpen: open,
            ...(open ? { bottomDockTabs: ensureDefaultDockTabs("bottom", state.bottomDockTabs) } : {}),
          }),
      setDockSize: (area, size) => set(area === "right"
        ? { rightDockWidth: normalizeRightDockWidth(size) }
        : { bottomDockHeight: normalizeBottomDockHeight(size) }),
      openDockTab: (area, kind) =>
        set((state) => {
          if (!dockTabCatalog(area).includes(kind)) return state;
          const current = dockTabState(area, state);
          const tabs = current.tabs.some((tab) => tab.kind === kind) ? current.tabs : [...current.tabs, createDockTab(kind)];
          return area === "right"
            ? { rightDockOpen: true, rightDockTabs: tabs, rightDockActiveTab: kind }
            : { bottomDockOpen: true, bottomDockTabs: tabs, bottomDockActiveTab: kind };
        }),
      closeDockTab: (area, tabId) =>
        set((state) => {
          const current = dockTabState(area, state);
          const tabs = normalizeDockTabs(area, current.tabs.filter((tab) => tab.id !== tabId));
          const activeTab = tabs.some((tab) => tab.kind === current.activeTab) ? current.activeTab : tabs[0].kind;
          return area === "right"
            ? { rightDockTabs: tabs, rightDockActiveTab: activeTab }
            : { bottomDockTabs: tabs, bottomDockActiveTab: activeTab };
        }),
      setDockActiveTab: (area, kind) =>
        set((state) => {
          const current = dockTabState(area, state);
          if (!current.tabs.some((tab) => tab.kind === kind)) return state;
          return area === "right"
            ? { rightDockActiveTab: kind }
            : { bottomDockActiveTab: kind };
        }),
      setDockDocument: (area, documentId) =>
        set((state) => area === "right"
          ? { rightDockOpen: true, rightDockDocumentId: documentId, rightDockTool: null, rightDockActiveTab: "files" }
          : {
              bottomDockOpen: true,
              bottomDockTabs: ensureDefaultDockTabs("bottom", state.bottomDockTabs),
              bottomDockDocumentId: documentId,
              bottomDockTool: null,
              bottomDockActiveTab: "files",
            }),
      setDockTool: (area, tool) =>
        set((state) => area === "right"
          ? { rightDockOpen: true, rightDockDocumentId: null, rightDockTool: tool, rightDockActiveTab: "files" }
          : {
              bottomDockOpen: true,
              bottomDockTabs: ensureDefaultDockTabs("bottom", state.bottomDockTabs),
              bottomDockDocumentId: null,
              bottomDockTool: tool,
              bottomDockActiveTab: "files",
            }),
      addDockDrop: (input) =>
        set((state) => {
          if (!dockTabCatalog(input.area).includes(input.tabKind)) return state;
          const items = dockDropItems(input);
          if (items.length === 0) return state;
          const current = dockTabState(input.area, state);
          const tabs = current.tabs.some((tab) => tab.kind === input.tabKind)
            ? current.tabs
            : [...current.tabs, createDockTab(input.tabKind)];
          return {
            ...(input.area === "right"
              ? { rightDockOpen: true, rightDockTabs: tabs, rightDockActiveTab: input.tabKind }
              : { bottomDockOpen: true, bottomDockTabs: tabs, bottomDockActiveTab: input.tabKind }),
            dockDroppedStructures: [...items, ...state.dockDroppedStructures].slice(0, 60),
          };
        }),
      toggleProjectsOpen: () => set((state) => ({ projectsOpen: !state.projectsOpen })),
      setExpandedProjectIds: (projectIds) => set({ expandedProjectIds: Array.from(new Set(projectIds)) }),
      addProjectRoot: (root) =>
        set((state) => {
          const normalized = normalizeRoot(root);
          if (!normalized) return state;
          if (state.projectRoots.includes(normalized)) return state;
          const projectId = `project:${normalized}`;
          return {
            projectRoots: [...state.projectRoots, normalized],
            hiddenProjectRoots: state.hiddenProjectRoots.filter((candidate) => candidate !== normalized),
            expandedProjectIds: state.expandedProjectIds.includes(projectId)
              ? state.expandedProjectIds
              : [...state.expandedProjectIds, projectId],
          };
        }),
      togglePinnedProjectRoot: (root) =>
        set((state) => {
          const normalized = normalizeRoot(root);
          if (!normalized || !state.projectRoots.includes(normalized)) return state;
          return {
            pinnedProjectRoots: state.pinnedProjectRoots.includes(normalized)
              ? state.pinnedProjectRoots.filter((candidate) => candidate !== normalized)
              : [...state.pinnedProjectRoots, normalized],
          };
        }),
      renameProjectRoot: (root, name) =>
        set((state) => {
          const normalized = normalizeRoot(root);
          if (!normalized) return state;
          const nextName = name.trim();
          const projectExists = state.projectRoots.includes(normalized);
          if (!projectExists && !nextName) return state;
          const { [normalized]: _removed, ...rest } = state.projectNameOverrides;
          if (projectExists) return { projectNameOverrides: nextName ? { ...rest, [normalized]: nextName } : rest };
          const projectId = `project:${normalized}`;
          return {
            projectRoots: [...state.projectRoots, normalized],
            hiddenProjectRoots: state.hiddenProjectRoots.filter((candidate) => candidate !== normalized),
            expandedProjectIds: state.expandedProjectIds.includes(projectId)
              ? state.expandedProjectIds
              : [...state.expandedProjectIds, projectId],
            projectNameOverrides: { ...rest, [normalized]: nextName },
          };
        }),
      removeProjectRoot: (root) =>
        set((state) => {
          const normalized = normalizeRoot(root);
          if (!normalized) return state;
          const { [normalized]: _removed, ...projectNameOverrides } = state.projectNameOverrides;
          const projectId = `project:${normalized}`;
          return {
            projectRoots: state.projectRoots.filter((candidate) => candidate !== normalized),
            pinnedProjectRoots: state.pinnedProjectRoots.filter((candidate) => candidate !== normalized),
            pinnedStructurePaths: state.pinnedStructurePaths.filter((candidate) => !isPathAtOrUnder(candidate, normalized)),
            expandedProjectIds: state.expandedProjectIds.filter((candidate) => candidate !== projectId),
            hiddenProjectRoots: state.hiddenProjectRoots.includes(normalized)
              ? state.hiddenProjectRoots
              : [...state.hiddenProjectRoots, normalized],
            projectNameOverrides,
          };
        }),
      togglePinnedStructure: (path) =>
        set((state) => {
          const normalized = normalizeRoot(path);
          if (!normalized) return state;
          return {
            pinnedStructurePaths: state.pinnedStructurePaths.includes(normalized)
              ? state.pinnedStructurePaths.filter((candidate) => candidate !== normalized)
              : [...state.pinnedStructurePaths, normalized],
          };
        }),
      pruneSidebarPaths: (existingPaths) =>
        set((state) => {
          const existing = new Set(existingPaths.map(normalizeRoot));
          const projectRoots = state.projectRoots.filter((root) => existing.has(root));
          const pinnedProjectRoots = state.pinnedProjectRoots.filter((root) => existing.has(root) && projectRoots.includes(root));
          const projectNameOverrides = persistentProjectNameOverrides(state.projectNameOverrides, projectRoots);
          const expandedProjectIds = persistentExpandedProjectIds(state.expandedProjectIds, projectRoots);
          const pinnedStructurePaths = state.pinnedStructurePaths.filter((path) => existing.has(path));
          if (
            projectRoots.length === state.projectRoots.length &&
            pinnedProjectRoots.length === state.pinnedProjectRoots.length &&
            expandedProjectIds.length === state.expandedProjectIds.length &&
            pinnedStructurePaths.length === state.pinnedStructurePaths.length &&
            Object.keys(projectNameOverrides).length === Object.keys(state.projectNameOverrides).length
          ) return state;
          return {
            projectRoots,
            pinnedProjectRoots,
            projectNameOverrides,
            expandedProjectIds,
            pinnedStructurePaths,
          };
        }),
      setSidebarQuery: (query) => set({ sidebarQuery: query }),
      toggleProjectExpanded: (projectId) =>
        set((state) => ({
          expandedProjectIds: state.expandedProjectIds.includes(projectId)
            ? state.expandedProjectIds.filter((candidate) => candidate !== projectId)
            : [...state.expandedProjectIds, projectId],
        })),
      restoreSnapshot: (snapshot) =>
        set(() => {
          const normalizedRightDockTabs = normalizeDockTabs("right", cloneJson(snapshot.rightDockTabs));
          const rightDockTabs = snapshot.rightDockOpen
            ? ensureDefaultDockTabs("right", normalizedRightDockTabs)
            : normalizedRightDockTabs;
          const bottomDockTabs = persistentDockTabs("bottom", cloneJson(snapshot.bottomDockTabs));
          const projectRoots = persistentRoots(snapshot.projectRoots);
          const pinnedProjectRoots = persistentRoots(snapshot.pinnedProjectRoots)
            .filter((root) => projectRoots.includes(root));
          return {
            sidebarOpen: snapshot.sidebarOpen,
            sidebarWidth: normalizeSidebarWidth(snapshot.sidebarWidth),
            rightDockOpen: snapshot.rightDockOpen,
            rightDockWidth: normalizeRightDockWidth(snapshot.rightDockWidth),
            rightDockTabs,
            rightDockActiveTab: normalizeDockActiveTab("right", rightDockTabs, snapshot.rightDockActiveTab),
            rightDockDocumentId: snapshot.rightDockDocumentId,
            rightDockTool: snapshot.rightDockTool,
            bottomDockOpen: snapshot.bottomDockOpen,
            bottomDockHeight: normalizeBottomDockHeight(snapshot.bottomDockHeight),
            bottomDockTabs,
            bottomDockActiveTab: normalizeDockActiveTab("bottom", bottomDockTabs, snapshot.bottomDockActiveTab),
            bottomDockDocumentId: snapshot.bottomDockDocumentId,
            bottomDockTool: snapshot.bottomDockTool,
            dockDroppedStructures: cloneJson(snapshot.dockDroppedStructures),
            projectsOpen: snapshot.projectsOpen,
            projectRoots,
            pinnedProjectRoots,
            projectNameOverrides: persistentProjectNameOverrides(snapshot.projectNameOverrides, projectRoots),
            expandedProjectIds: persistentExpandedProjectIds(snapshot.expandedProjectIds, projectRoots),
            hiddenProjectRoots: persistentRoots(snapshot.hiddenProjectRoots).filter((root) => !projectRoots.includes(root)),
            pinnedStructurePaths: persistentPinnedPaths(snapshot.pinnedStructurePaths),
          };
        }),
    }),
    {
      name: workspaceStorageKey("burrete.shell.ui", { windowScoped: false }),
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        sidebarWidth: state.sidebarWidth,
        rightDockOpen: state.rightDockOpen,
        rightDockWidth: state.rightDockWidth,
        rightDockTabs: normalizeDockTabs("right", state.rightDockTabs),
        rightDockActiveTab: normalizeDockActiveTab("right", normalizeDockTabs("right", state.rightDockTabs), state.rightDockActiveTab),
        bottomDockOpen: state.bottomDockOpen,
        bottomDockHeight: state.bottomDockHeight,
        bottomDockTabs: persistentDockTabs("bottom", state.bottomDockTabs),
        bottomDockActiveTab: normalizeDockActiveTab("bottom", persistentDockTabs("bottom", state.bottomDockTabs), state.bottomDockActiveTab),
        projectsOpen: state.projectsOpen,
        projectRoots: persistentRoots(state.projectRoots),
        pinnedProjectRoots: persistentRoots(state.pinnedProjectRoots),
        projectNameOverrides: persistentProjectNameOverrides(state.projectNameOverrides, persistentRoots(state.projectRoots)),
        expandedProjectIds: persistentExpandedProjectIds(state.expandedProjectIds, persistentRoots(state.projectRoots)),
        hiddenProjectRoots: persistentRoots(state.hiddenProjectRoots),
        pinnedStructurePaths: persistentPinnedPaths(state.pinnedStructurePaths),
      }),
      merge: (persisted, current) => {
        const stored = persisted as Partial<PersistedShellState> | undefined;
        const rightDockOpen = stored?.rightDockOpen ?? current.rightDockOpen;
        const normalizedRightDockTabs = normalizeDockTabs("right", stored?.rightDockTabs ?? current.rightDockTabs);
        const rightDockTabs = rightDockOpen ? ensureDefaultDockTabs("right", normalizedRightDockTabs) : normalizedRightDockTabs;
        const bottomDockOpen = stored?.bottomDockOpen ?? current.bottomDockOpen;
        const normalizedBottomDockTabs = persistentDockTabs("bottom", stored?.bottomDockTabs ?? current.bottomDockTabs);
        const bottomDockTabs = bottomDockOpen ? ensureDefaultDockTabs("bottom", normalizedBottomDockTabs) : normalizedBottomDockTabs;
        const projectRoots = persistentRoots(stored?.projectRoots ?? current.projectRoots);
        const pinnedProjectRoots = persistentRoots(stored?.pinnedProjectRoots ?? current.pinnedProjectRoots)
          .filter((root) => projectRoots.includes(root));
        const hiddenProjectRoots = persistentRoots(stored?.hiddenProjectRoots ?? current.hiddenProjectRoots)
          .filter((root) => !projectRoots.includes(root));
        return {
          ...current,
          sidebarOpen: stored?.sidebarOpen ?? current.sidebarOpen,
          sidebarWidth: normalizeSidebarWidth(stored?.sidebarWidth ?? current.sidebarWidth),
          rightDockOpen,
          rightDockWidth: normalizeRightDockWidth(stored?.rightDockWidth ?? current.rightDockWidth),
          rightDockTabs,
          rightDockActiveTab: normalizeDockActiveTab(
            "right",
            rightDockTabs,
            stored?.rightDockActiveTab ?? current.rightDockActiveTab,
          ),
          bottomDockOpen,
          bottomDockHeight: normalizeBottomDockHeight(stored?.bottomDockHeight ?? current.bottomDockHeight),
          bottomDockTabs,
          bottomDockActiveTab: normalizeDockActiveTab(
            "bottom",
            bottomDockTabs,
            stored?.bottomDockActiveTab ?? current.bottomDockActiveTab,
          ),
          projectsOpen: stored?.projectsOpen ?? current.projectsOpen,
          projectRoots,
          pinnedProjectRoots,
          projectNameOverrides: persistentProjectNameOverrides(stored?.projectNameOverrides ?? current.projectNameOverrides, projectRoots),
          expandedProjectIds: persistentExpandedProjectIds(stored?.expandedProjectIds ?? current.expandedProjectIds, projectRoots),
          hiddenProjectRoots,
          pinnedStructurePaths: persistentPinnedPaths(stored?.pinnedStructurePaths ?? current.pinnedStructurePaths),
        };
      },
    },
  ),
);
