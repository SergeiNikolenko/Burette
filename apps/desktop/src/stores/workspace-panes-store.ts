import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { workspaceStorageKey } from "../lib/window-scope";

// Geometry of the floating window. Which screen it shows is a property of the
// tab itself (`MoleculeTab.pane` in the molecule store), so this store only
// remembers how the window is laid out.
export type FloatingPaneRect = { x: number; y: number; width: number; height: number };

type WorkspacePanesState = {
  floating: FloatingPaneRect;
  floatingMinimized: boolean;
  setFloatingRect: (rect: FloatingPaneRect) => void;
  setFloatingMinimized: (minimized: boolean) => void;
};

type PersistedWorkspacePanes = Pick<WorkspacePanesState, "floating" | "floatingMinimized">;

// The atlas hotkey window: 470 x 640 by default, at least 400 x 400.
export const FLOATING_PANE_MIN_WIDTH = 400;
export const FLOATING_PANE_MIN_HEIGHT = 400;

const DEFAULT_FLOATING: FloatingPaneRect = { x: -1, y: -1, width: 470, height: 640 };

function finite(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
}

export function normalizeFloatingRect(rect: Partial<FloatingPaneRect> | undefined): FloatingPaneRect {
  return {
    x: finite(rect?.x, DEFAULT_FLOATING.x),
    y: finite(rect?.y, DEFAULT_FLOATING.y),
    width: Math.max(FLOATING_PANE_MIN_WIDTH, finite(rect?.width, DEFAULT_FLOATING.width)),
    height: Math.max(FLOATING_PANE_MIN_HEIGHT, finite(rect?.height, DEFAULT_FLOATING.height)),
  };
}

// Keeps the window on screen. A negative origin is the "not placed yet"
// default, which puts the window at the bottom-right corner of the viewport.
export function placeFloatingRect(rect: FloatingPaneRect, viewport: { width: number; height: number }, inset = 16) {
  const width = Math.min(rect.width, Math.max(FLOATING_PANE_MIN_WIDTH, viewport.width - inset * 2));
  const height = Math.min(rect.height, Math.max(FLOATING_PANE_MIN_HEIGHT, viewport.height - inset * 2));
  const x = rect.x < 0 ? viewport.width - width - inset : rect.x;
  const y = rect.y < 0 ? viewport.height - height - inset : rect.y;
  return {
    x: Math.max(inset, Math.min(viewport.width - width - inset, x)),
    y: Math.max(inset, Math.min(viewport.height - height - inset, y)),
    width,
    height,
  };
}

export const useWorkspacePanesStore = create<WorkspacePanesState>()(
  persist<WorkspacePanesState, [], [], PersistedWorkspacePanes>(
    (set) => ({
      floating: DEFAULT_FLOATING,
      floatingMinimized: false,
      setFloatingRect: (rect) => set({ floating: normalizeFloatingRect(rect) }),
      setFloatingMinimized: (floatingMinimized) => set({ floatingMinimized }),
    }),
    {
      name: workspaceStorageKey("burette.workspace-panes"),
      storage: createJSONStorage(() => window.BuretteMcpWorkspace?.storage ?? localStorage),
      version: 1,
      partialize: (state) => ({
        floating: state.floating,
        floatingMinimized: state.floatingMinimized,
      }),
      merge: (persisted, current) => {
        const stored = persisted as Partial<PersistedWorkspacePanes> | undefined;
        return {
          ...current,
          floating: normalizeFloatingRect(stored?.floating),
          floatingMinimized: stored?.floatingMinimized === true,
        };
      },
    },
  ),
);
