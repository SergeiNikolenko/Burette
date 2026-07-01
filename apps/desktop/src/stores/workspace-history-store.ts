import { create } from "zustand";
import {
  getMoleculeStoreSnapshot,
  useMoleculeStore,
  type MoleculeStoreSnapshot,
} from "./molecule-store";
import {
  getSettingsStoreSnapshot,
  useSettingsStore,
  type SettingsStoreSnapshot,
} from "./settings-store";
import {
  getShellStoreSnapshot,
  useShellStore,
  type ShellStoreSnapshot,
} from "./shell-store";

export type WorkspaceHistoryGroup =
  | "navigation"
  | "documents"
  | "settings"
  | "layout"
  | "workspace"
  | "ketcher"
  | "grid"
  | "docking"
  | "chemistry";

export type WorkspaceHistorySnapshot = {
  molecule: MoleculeStoreSnapshot;
  shell: ShellStoreSnapshot;
  settings: SettingsStoreSnapshot;
  extras: Record<string, unknown>;
};

export type WorkspaceHistoryEntry = {
  id: string;
  label: string;
  group: WorkspaceHistoryGroup;
  before: WorkspaceHistorySnapshot;
  after: WorkspaceHistorySnapshot;
  timestamp: number;
};

type WorkspaceHistoryExtraAdapter = {
  capture: () => Record<string, unknown>;
  restore: (extras: Record<string, unknown>) => void;
};

type WorkspaceHistoryPendingGroup = {
  id: string;
  label: string;
  group: WorkspaceHistoryGroup;
  before: WorkspaceHistorySnapshot;
};

type WorkspaceHistoryState = {
  undoStack: WorkspaceHistoryEntry[];
  redoStack: WorkspaceHistoryEntry[];
  pendingGroup: WorkspaceHistoryPendingGroup | null;
  isRestoring: boolean;
  canUndo: boolean;
  canRedo: boolean;
  withWorkspaceHistory: <T>(label: string, group: WorkspaceHistoryGroup, action: () => T) => T;
  beginHistoryGroup: (label: string, group: WorkspaceHistoryGroup) => void;
  updateHistoryGroup: () => void;
  commitHistoryGroup: () => void;
  cancelHistoryGroup: () => void;
  undoWorkspaceAction: () => boolean;
  redoWorkspaceAction: () => boolean;
  clearWorkspaceHistory: () => void;
};

let entrySequence = 0;
let extraAdapter: WorkspaceHistoryExtraAdapter = {
  capture: () => ({}),
  restore: () => {},
};

function nextEntryId() {
  entrySequence += 1;
  return `workspace-history-${entrySequence}`;
}

function snapshotEquals(left: WorkspaceHistorySnapshot, right: WorkspaceHistorySnapshot) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function captureWorkspaceSnapshot(): WorkspaceHistorySnapshot {
  return {
    molecule: getMoleculeStoreSnapshot(),
    shell: getShellStoreSnapshot(),
    settings: getSettingsStoreSnapshot(),
    extras: extraAdapter.capture(),
  };
}

function restoreWorkspaceSnapshot(snapshot: WorkspaceHistorySnapshot) {
  useMoleculeStore.getState().restoreSnapshot(snapshot.molecule);
  useShellStore.getState().restoreSnapshot(snapshot.shell);
  useSettingsStore.getState().restoreSnapshot(snapshot.settings);
  extraAdapter.restore(snapshot.extras);
}

function entryFromSnapshots(
  label: string,
  group: WorkspaceHistoryGroup,
  before: WorkspaceHistorySnapshot,
  after: WorkspaceHistorySnapshot,
): WorkspaceHistoryEntry | null {
  if (snapshotEquals(before, after)) return null;
  return {
    id: nextEntryId(),
    label,
    group,
    before,
    after,
    timestamp: Date.now(),
  };
}

function pushUndoEntry(entry: WorkspaceHistoryEntry) {
  useWorkspaceHistoryStore.setState((state) => ({
    undoStack: [...state.undoStack, entry],
    redoStack: [],
    canUndo: true,
    canRedo: false,
  }));
}

export function configureWorkspaceHistoryExtras(adapter: Partial<WorkspaceHistoryExtraAdapter>) {
  extraAdapter = {
    capture: adapter.capture ?? (() => ({})),
    restore: adapter.restore ?? (() => {}),
  };
}

export function workspaceHistoryNone<T>(action: () => T): T {
  return action();
}

export const useWorkspaceHistoryStore = create<WorkspaceHistoryState>()((set, get) => ({
  undoStack: [],
  redoStack: [],
  pendingGroup: null,
  isRestoring: false,
  canUndo: false,
  canRedo: false,
  withWorkspaceHistory: (label, group, action) => {
    if (get().isRestoring || get().pendingGroup) return action();
    const before = captureWorkspaceSnapshot();
    const result = action();
    if (result instanceof Promise) {
      return result.then((value) => {
        const entry = entryFromSnapshots(label, group, before, captureWorkspaceSnapshot());
        if (entry) pushUndoEntry(entry);
        return value;
      }) as typeof result;
    }
    const entry = entryFromSnapshots(label, group, before, captureWorkspaceSnapshot());
    if (entry) pushUndoEntry(entry);
    return result;
  },
  beginHistoryGroup: (label, group) => {
    if (get().isRestoring || get().pendingGroup) return;
    set({
      pendingGroup: {
        id: nextEntryId(),
        label,
        group,
        before: captureWorkspaceSnapshot(),
      },
    });
  },
  updateHistoryGroup: () => {
    // The grouped entry uses the latest workspace snapshot on commit.
  },
  commitHistoryGroup: () => {
    const pending = get().pendingGroup;
    if (!pending) return;
    const entry = entryFromSnapshots(pending.label, pending.group, pending.before, captureWorkspaceSnapshot());
    set({ pendingGroup: null });
    if (entry) pushUndoEntry(entry);
  },
  cancelHistoryGroup: () => {
    set({ pendingGroup: null });
  },
  undoWorkspaceAction: () => {
    const entry = get().undoStack.at(-1);
    if (!entry) return false;
    set({ isRestoring: true });
    try {
      restoreWorkspaceSnapshot(entry.before);
    } finally {
      set((state) => {
        const undoStack = state.undoStack.slice(0, -1);
        const redoStack = [...state.redoStack, entry];
        return {
          undoStack,
          redoStack,
          isRestoring: false,
          canUndo: undoStack.length > 0,
          canRedo: redoStack.length > 0,
        };
      });
    }
    return true;
  },
  redoWorkspaceAction: () => {
    const entry = get().redoStack.at(-1);
    if (!entry) return false;
    set({ isRestoring: true });
    try {
      restoreWorkspaceSnapshot(entry.after);
    } finally {
      set((state) => {
        const redoStack = state.redoStack.slice(0, -1);
        const undoStack = [...state.undoStack, entry];
        return {
          undoStack,
          redoStack,
          isRestoring: false,
          canUndo: undoStack.length > 0,
          canRedo: redoStack.length > 0,
        };
      });
    }
    return true;
  },
  clearWorkspaceHistory: () => {
    set({
      undoStack: [],
      redoStack: [],
      pendingGroup: null,
      canUndo: false,
      canRedo: false,
      isRestoring: false,
    });
  },
}));

