import { create } from "zustand";
import { persist } from "zustand/middleware";

type ShellState = {
  sidebarOpen: boolean;
  sidebarWidth: number;
  projectRoots: string[];
  expandedProjectIds: string[];
  sidebarQuery: string;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  addProjectRoot: (root: string) => void;
  setSidebarQuery: (query: string) => void;
  toggleProjectExpanded: (projectId: string) => void;
};

type PersistedShellState = Pick<ShellState, "sidebarOpen" | "sidebarWidth" | "projectRoots" | "expandedProjectIds">;

function normalizeRoot(root: string) {
  return root.replace(/\\/g, "/").replace(/\/+$/g, "");
}

export const useShellStore = create<ShellState>()(
  persist<ShellState, [], [], PersistedShellState>(
    (set) => ({
      sidebarOpen: true,
      sidebarWidth: 268,
      projectRoots: [],
      expandedProjectIds: [],
      sidebarQuery: "",
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarWidth: (width) => set({ sidebarWidth: Math.max(220, Math.min(420, Math.round(width))) }),
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
        projectRoots: state.projectRoots,
        expandedProjectIds: state.expandedProjectIds,
      }),
      merge: (persisted, current) => {
        const stored = persisted as Partial<PersistedShellState> | undefined;
        return {
          ...current,
          sidebarOpen: stored?.sidebarOpen ?? current.sidebarOpen,
          sidebarWidth: stored?.sidebarWidth ?? current.sidebarWidth,
          projectRoots: stored?.projectRoots ?? current.projectRoots,
          expandedProjectIds: stored?.expandedProjectIds ?? current.expandedProjectIds,
        };
      },
    },
  ),
);
