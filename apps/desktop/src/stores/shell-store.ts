import { create } from "zustand";
import { persist } from "zustand/middleware";

type ShellState = {
  sidebarOpen: boolean;
  sidebarWidth: number;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
};

type PersistedShellState = Pick<ShellState, "sidebarOpen" | "sidebarWidth">;

export const useShellStore = create<ShellState>()(
  persist<ShellState, [], [], PersistedShellState>(
    (set) => ({
      sidebarOpen: true,
      sidebarWidth: 268,
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarWidth: (width) => set({ sidebarWidth: Math.max(220, Math.min(420, Math.round(width))) }),
    }),
    {
      name: "burrete.shell.ui",
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        sidebarWidth: state.sidebarWidth,
      }),
      merge: (persisted, current) => {
        const stored = persisted as Partial<PersistedShellState> | undefined;
        return {
          ...current,
          sidebarOpen: stored?.sidebarOpen ?? current.sidebarOpen,
          sidebarWidth: stored?.sidebarWidth ?? current.sidebarWidth,
        };
      },
    },
  ),
);
