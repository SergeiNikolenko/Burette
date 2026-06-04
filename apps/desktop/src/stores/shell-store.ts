import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isTemporaryDocumentPath } from "../lib/temporary-documents";

type ShellState = {
  sidebarOpen: boolean;
  sidebarWidth: number;
  projectsOpen: boolean;
  projectRoots: string[];
  expandedProjectIds: string[];
  pinnedStructurePaths: string[];
  sidebarQuery: string;
  toggleSidebar: () => void;
  closeSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  toggleProjectsOpen: () => void;
  setExpandedProjectIds: (projectIds: string[]) => void;
  addProjectRoot: (root: string) => void;
  togglePinnedStructure: (path: string) => void;
  setSidebarQuery: (query: string) => void;
  toggleProjectExpanded: (projectId: string) => void;
};

type PersistedShellState = Pick<ShellState, "sidebarOpen" | "sidebarWidth" | "projectsOpen" | "projectRoots" | "expandedProjectIds" | "pinnedStructurePaths">;

function normalizeRoot(root: string) {
  return root.replace(/\\/g, "/").replace(/\/+$/g, "");
}

function persistentRoots(roots: string[]) {
  return roots.map(normalizeRoot).filter((root) => root && !isTemporaryDocumentPath(root));
}

function persistentPinnedPaths(paths: string[]) {
  return paths.map(normalizeRoot).filter((path) => path && !isTemporaryDocumentPath(path));
}

function persistentExpandedProjectIds(projectIds: string[], projectRoots: string[]) {
  const allowed = new Set(projectRoots.map((root) => `project:${root}`));
  return projectIds.filter((projectId) => !projectId.startsWith("project:") || allowed.has(projectId));
}

function normalizeSidebarWidth(width: number) {
  return Math.max(220, Math.min(420, Math.round(width)));
}

export const useShellStore = create<ShellState>()(
  persist<ShellState, [], [], PersistedShellState>(
    (set) => ({
      sidebarOpen: true,
      sidebarWidth: 240,
      projectsOpen: true,
      projectRoots: [],
      expandedProjectIds: [],
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
          const projectId = `project:${normalized}`;
          return {
            projectRoots: [...state.projectRoots, normalized],
            expandedProjectIds: state.expandedProjectIds.includes(projectId)
              ? state.expandedProjectIds
              : [...state.expandedProjectIds, projectId],
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
      setSidebarQuery: (query) => set({ sidebarQuery: query }),
      toggleProjectExpanded: (projectId) =>
        set((state) => ({
          expandedProjectIds: state.expandedProjectIds.includes(projectId)
            ? state.expandedProjectIds.filter((candidate) => candidate !== projectId)
            : [...state.expandedProjectIds, projectId],
        })),
    }),
    {
      name: "burrete.shell.ui",
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        sidebarWidth: state.sidebarWidth,
        projectsOpen: state.projectsOpen,
        projectRoots: persistentRoots(state.projectRoots),
        expandedProjectIds: persistentExpandedProjectIds(state.expandedProjectIds, persistentRoots(state.projectRoots)),
        pinnedStructurePaths: persistentPinnedPaths(state.pinnedStructurePaths),
      }),
      merge: (persisted, current) => {
        const stored = persisted as Partial<PersistedShellState> | undefined;
        const projectRoots = persistentRoots(stored?.projectRoots ?? current.projectRoots);
        return {
          ...current,
          sidebarOpen: stored?.sidebarOpen ?? current.sidebarOpen,
          sidebarWidth: normalizeSidebarWidth(stored?.sidebarWidth ?? current.sidebarWidth),
          projectsOpen: stored?.projectsOpen ?? current.projectsOpen,
          projectRoots,
          expandedProjectIds: persistentExpandedProjectIds(stored?.expandedProjectIds ?? current.expandedProjectIds, projectRoots),
          pinnedStructurePaths: persistentPinnedPaths(stored?.pinnedStructurePaths ?? current.pinnedStructurePaths),
        };
      },
    },
  ),
);
