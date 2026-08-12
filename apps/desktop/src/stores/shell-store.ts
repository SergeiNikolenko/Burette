import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isTemporaryDocumentPath } from "../lib/temporary-documents";
import { workspaceStorageKey } from "../lib/window-scope";

type ShellState = {
  sidebarOpen: boolean;
  sidebarWidth: number;
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
  toggleProjectsOpen: () => void;
  setExpandedProjectIds: (projectIds: string[]) => void;
  addProjectRoot: (root: string) => void;
  togglePinnedProjectRoot: (root: string) => void;
  renameProjectRoot: (root: string, name: string) => void;
  renameProjectFolder: (folderPath: string, name: string) => void;
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
  | "projectsOpen"
  | "projectRoots"
  | "pinnedProjectRoots"
  | "projectNameOverrides"
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
  return Object.fromEntries(
    Object.entries(overrides)
      .map(([root, name]) => [normalizeRoot(root), name.trim()] as const)
      .filter(([root, name]) => name.length > 0 && projectRoots.some((projectRoot) => isPathAtOrUnder(root, projectRoot))),
  );
}

function persistentExpandedProjectIds(projectIds: string[], projectRoots: string[]) {
  const allowed = new Set(projectRoots.map((root) => `project:${root}`));
  return projectIds.filter((projectId) => !projectId.startsWith("project:") || allowed.has(projectId));
}

function normalizeSidebarWidth(width: number) {
  return Math.max(220, Math.min(420, Math.round(width)));
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function getShellStoreSnapshot(): ShellStoreSnapshot {
  const state = useShellStore.getState();
  return cloneJson({
    sidebarOpen: state.sidebarOpen,
    sidebarWidth: state.sidebarWidth,
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
      toggleProjectsOpen: () => set((state) => ({ projectsOpen: !state.projectsOpen })),
      setExpandedProjectIds: (projectIds) => set({ expandedProjectIds: Array.from(new Set(projectIds)) }),
      addProjectRoot: (root) =>
        set((state) => {
          const normalized = normalizeRoot(root);
          if (!normalized) return state;
          if (state.projectRoots.includes(normalized)) return state;
          return {
            projectRoots: [...state.projectRoots, normalized],
            hiddenProjectRoots: state.hiddenProjectRoots.filter((candidate) => candidate !== normalized),
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
          return {
            projectRoots: [...state.projectRoots, normalized],
            hiddenProjectRoots: state.hiddenProjectRoots.filter((candidate) => candidate !== normalized),
            projectNameOverrides: { ...rest, [normalized]: nextName },
          };
        }),
      renameProjectFolder: (folderPath, name) =>
        set((state) => {
          const normalized = normalizeRoot(folderPath);
          if (!normalized || !state.projectRoots.some((root) => isPathAtOrUnder(normalized, root) && normalized !== root)) return state;
          const nextName = name.trim();
          const { [normalized]: _removed, ...rest } = state.projectNameOverrides;
          return {
            projectNameOverrides: nextName ? { ...rest, [normalized]: nextName } : rest,
          };
        }),
      removeProjectRoot: (root) =>
        set((state) => {
          const normalized = normalizeRoot(root);
          if (!normalized) return state;
          const projectNameOverrides = Object.fromEntries(
            Object.entries(state.projectNameOverrides).filter(([path]) => !isPathAtOrUnder(normalizeRoot(path), normalized)),
          );
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
          const projectRoots = persistentRoots(snapshot.projectRoots);
          const pinnedProjectRoots = persistentRoots(snapshot.pinnedProjectRoots)
            .filter((root) => projectRoots.includes(root));
          return {
            sidebarOpen: snapshot.sidebarOpen,
            sidebarWidth: normalizeSidebarWidth(snapshot.sidebarWidth),
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
      name: workspaceStorageKey("burette.shell.ui", { windowScoped: false }),
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        sidebarWidth: state.sidebarWidth,
        projectsOpen: state.projectsOpen,
        projectRoots: persistentRoots(state.projectRoots),
        pinnedProjectRoots: persistentRoots(state.pinnedProjectRoots),
        projectNameOverrides: persistentProjectNameOverrides(state.projectNameOverrides, persistentRoots(state.projectRoots)),
        hiddenProjectRoots: persistentRoots(state.hiddenProjectRoots),
        pinnedStructurePaths: persistentPinnedPaths(state.pinnedStructurePaths),
      }),
      merge: (persisted, current) => {
        const stored = persisted as Partial<PersistedShellState> | undefined;
        const projectRoots = persistentRoots(stored?.projectRoots ?? current.projectRoots);
        const pinnedProjectRoots = persistentRoots(stored?.pinnedProjectRoots ?? current.pinnedProjectRoots)
          .filter((root) => projectRoots.includes(root));
        const hiddenProjectRoots = persistentRoots(stored?.hiddenProjectRoots ?? current.hiddenProjectRoots)
          .filter((root) => !projectRoots.includes(root));
        return {
          ...current,
          sidebarOpen: stored?.sidebarOpen ?? current.sidebarOpen,
          sidebarWidth: normalizeSidebarWidth(stored?.sidebarWidth ?? current.sidebarWidth),
          projectsOpen: stored?.projectsOpen ?? current.projectsOpen,
          projectRoots,
          pinnedProjectRoots,
          projectNameOverrides: persistentProjectNameOverrides(stored?.projectNameOverrides ?? current.projectNameOverrides, projectRoots),
          hiddenProjectRoots,
          pinnedStructurePaths: persistentPinnedPaths(stored?.pinnedStructurePaths ?? current.pinnedStructurePaths),
        };
      },
    },
  ),
);
