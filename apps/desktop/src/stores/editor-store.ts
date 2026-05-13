import { create } from "zustand";
import type { AppPage, DocumentLoadState, ShellTab } from "../components/types";

type UtilityTab = Extract<ShellTab, { kind: "launcher" | "settings" }>;
type StateUpdater<T> = T | ((current: T) => T);

function resolveState<T>(current: T, update: StateUpdater<T>) {
  return typeof update === "function" ? (update as (current: T) => T)(current) : update;
}

let tabSequence = 0;

function createTabId() {
  tabSequence += 1;
  return `tab-${tabSequence}`;
}

export function createLauncherTab(id = createTabId()): UtilityTab {
  return { id, kind: "launcher", title: "New tab" };
}

export function createSettingsTab(id = "settings"): UtilityTab {
  return { id, kind: "settings", title: "Settings" };
}

type EditorState = {
  page: AppPage;
  utilityTabs: UtilityTab[];
  activeUtilityTabId: string | null;
  navigationBack: string[];
  navigationForward: string[];
  documentLoadStates: Record<string, DocumentLoadState>;
  setPage: (page: AppPage) => void;
  setUtilityTabs: (tabs: StateUpdater<UtilityTab[]>) => void;
  setActiveUtilityTabId: (id: string | null) => void;
  setNavigationBack: (stack: StateUpdater<string[]>) => void;
  setNavigationForward: (stack: StateUpdater<string[]>) => void;
  setDocumentLoadState: (id: string, loadState: DocumentLoadState) => void;
  clearDocumentLoadState: (id: string) => void;
  resetNavigation: () => void;
  resetUtilityTabs: () => void;
};

export const useEditorStore = create<EditorState>((set) => ({
  page: "viewer",
  utilityTabs: [],
  activeUtilityTabId: null,
  navigationBack: [],
  navigationForward: [],
  documentLoadStates: {},
  setPage: (page) => set({ page }),
  setUtilityTabs: (tabs) =>
    set((state) => ({
      utilityTabs: resolveState(state.utilityTabs, tabs),
    })),
  setActiveUtilityTabId: (id) => set({ activeUtilityTabId: id }),
  setNavigationBack: (stack) =>
    set((state) => ({
      navigationBack: resolveState(state.navigationBack, stack),
    })),
  setNavigationForward: (stack) =>
    set((state) => ({
      navigationForward: resolveState(state.navigationForward, stack),
    })),
  setDocumentLoadState: (id, loadState) =>
    set((state) => ({
      documentLoadStates: { ...state.documentLoadStates, [id]: loadState },
    })),
  clearDocumentLoadState: (id) =>
    set((state) => {
      const { [id]: _removed, ...documentLoadStates } = state.documentLoadStates;
      return { documentLoadStates };
    }),
  resetNavigation: () => set({ navigationBack: [], navigationForward: [] }),
  resetUtilityTabs: () => set({ utilityTabs: [], activeUtilityTabId: null }),
}));
