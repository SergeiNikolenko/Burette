import { canTransferNativeTab, moveNativeTab } from "../editor-area/native-tab-transfer";
import { openNativePageWindow } from "./native-page-window";
import type { MenuItemSpec } from "../menu-types";
import type { ShellActions, ShellViewState } from "../types";
import type * as AppIconData from "../ui/app-icon-data";
import { canOpenNativePopout, openNativePopout } from "./native-popout";
import { returnClosedTab, takeClosedTab } from "../../stores/closed-tabs";
import type { Location } from "../editor-area/page-kinds";
import { useMoleculeStore, type MoleculeTab, type TabPane } from "../../stores/molecule-store";
import { useWorkspacePanesStore } from "../../stores/workspace-panes-store";
import { isTauriRuntime } from "../../lib/tauri";
import { isNativePopoutTab, returnNativePopout as returnMovedScene } from "./native-scene-window";
import { toast } from "../ui/toast";

// Moving a screen between the main strip and the floating window. The page
// itself never remounts (see ViewerArea); these only change where its surface
// is laid out.
export function placeScreen(tabId: string, pane: TabPane | null) {
  useWorkspacePanesStore.getState().setFullView(null);
  useMoleculeStore.getState().placeTab(tabId, pane);
  if (pane === "right" || pane === "bottom") useWorkspacePanesStore.getState().setGroupOpen(pane, true);
  if (pane === "floating") useWorkspacePanesStore.getState().setFloatingMinimized(false);
}

export function openScreen(location: Location, pane?: TabPane | null, options?: { newTab: boolean }) {
  const id = useMoleculeStore.getState().openScreenTab(location, pane, options);
  const targetPane = pane === undefined ? useMoleculeStore.getState().tabs.find(tab => tab.id === id)?.pane : pane;
  if (targetPane === "floating") useWorkspacePanesStore.getState().setFloatingMinimized(false);
}

// All new-screen entry points share the same empty-tab reuse rule.
export function openScreenInGroup(location: Location, pane: TabPane | null, selectedTabId?: string) {
  const store = useMoleculeStore.getState();
  const empty = store.tabs.find(tab => tab.id === selectedTabId && (tab.pane ?? null) === pane
    && tab.location.kind === "launcher" && !tab.pinned && !tab.title && !tab.back.length && !tab.forward.length);
  if (empty && location.kind !== "launcher") {
    store.navigateTabLocation(empty.id, location, "replace");
    store.setActiveTab(empty.id);
  } else openScreen(location, pane, { newTab: true });
  if (pane === "right" || pane === "bottom") useWorkspacePanesStore.getState().setGroupOpen(pane, true);
}

// File loading can be asynchronous; consecutive ⇧⌘T requests must restore the
// stack in order rather than applying metadata to each other's newly opened tab.
let reopenQueue = Promise.resolve();
export function reopenClosedTab(actions: Pick<ShellActions, "openStructurePaths" | "openTextPaths">) {
  reopenQueue = reopenQueue.then(async () => {
    const entry = takeClosedTab();
    if (!entry) return;
    const { tab, index, rendererMode } = entry;
    const { location } = tab;
    const existingIds = new Set(useMoleculeStore.getState().tabs.map(current => current.id));
    try {
      if (location.kind === "file") await actions.openStructurePaths([location.recoveryPath ?? location.path], {
        rendererMode,
        ...(location.gridViewMode ? { gridViewMode: location.gridViewMode } : {}),
        ...(location.gridViewState !== undefined ? { gridViewState: location.gridViewState } : {}),
      });
      else if (location.kind === "text-file") await actions.openTextPaths([location.path]);
      else openScreen(location, tab.pane ?? null, { newTab: true });
      const matches = (current: MoleculeTab) => current.location === location || (
        (location.kind === "file" || location.kind === "text-file")
        && current.location.kind === location.kind && current.location.path === location.path
      );
      const restored = useMoleculeStore.getState().tabs.find(current => !existingIds.has(current.id) && matches(current));
      if (!restored) {
        // An already-open file may have been activated; preserve its own view.
        if (useMoleculeStore.getState().tabs.some(matches)) return;
        throw new Error("The closed tab could not be reopened");
      }
      useMoleculeStore.setState(state => ({ tabs: state.tabs.map(current => current.id === restored.id
        ? { ...current, title: tab.title, pinned: tab.pinned, back: tab.back, forward: tab.forward }
        : current) }));
      placeScreen(restored.id, tab.pane ?? null);
      useMoleculeStore.getState().moveTab(restored.id, index);
    } catch {
      returnClosedTab(entry);
      toast.add({ title: "Could not reopen tab", description: "Check that the file is available and try again.", type: "error" });
    }
  });
  return reopenQueue;
}

// The screens that are not files, offered by the new-tab menu and the pane
// switchers. Start page first, like Codex's "New page".
export const SCREEN_ENTRIES: { id: string; text: string; icon: keyof typeof AppIconData; location: Location }[] = [
  { id: "screen-launcher", text: "New tab", icon: "Plus", location: { kind: "launcher" } },
  { id: "screen-files", text: "Files", icon: "Folder", location: { kind: "tool", tool: "files", area: "right" } },
  { id: "screen-jobs", text: "Jobs", icon: "Stopwatch", location: { kind: "jobs" } },
  { id: "screen-chemical-space", text: "Chemical space", icon: "Orbit", location: { kind: "chemical-space" } },
  { id: "screen-ketcher", text: "Molecular editor", icon: "Edit", location: { kind: "ketcher" } },
];

// "Pop out", "Move to New Window" and "Move to Main Window" for one screen, shared by the tab context
// menu and the floating window header so they always agree.
export function paneMoveItems(tab: MoleculeTab, state: ShellViewState, actions: ShellActions): MenuItemSpec[] {
  const full = useWorkspacePanesStore.getState().fullViewTabId === tab.id;
  const nativeWidget = Boolean(window.BuretteMcpWorkspace);
  const panes: TabPane[] = nativeWidget ? ["right"] : ["right", "bottom"];
  const items: MenuItemSpec[] = [
    { kind: "item", id: "pane-full-view", text: full ? "Exit Full View" : "Enter Full View", action: () => {
      useMoleculeStore.getState().setActiveTab(tab.id);
      useWorkspacePanesStore.getState().setFullView(full ? null : tab.id);
    } },
    ...panes.filter(pane => tab.pane !== pane).map(pane => ({
      kind: "item" as const, id: `pane-split-${pane}`, text: pane === "right" ? "Move to Right Split" : "Move to Bottom Split", action: () => placeScreen(tab.id, pane),
    })),
  ];
  if (isNativePopoutTab(tab.id)) return [{ kind: "item", id: "pane-return-main", text: "Move to Main Window", action: () => {
    void returnMovedScene(tab.id).catch(() => toast.add({ title: "Could not return scene", description: "Keep this window open and try again.", type: "error" }));
  } }];
  if (tab.pane) {
    items.push({ kind: "item", id: "pane-move-main", text: "Move to Main Tabs", action: () => placeScreen(tab.id, null) });
  }
  if (!nativeWidget && (canOpenNativePopout(tab) || tab.pane !== "floating")) {
    items.push({ kind: "item", id: "pane-pop-out", text: "Pop out", action: async () => {
      if (canOpenNativePopout(tab)) {
        if (await openNativePopout(tab, state, actions)) placeScreen(tab.id, null);
      } else placeScreen(tab.id, "floating");
    } });
  }
  // Pop out copies the scene into a compact preview; this moves the scene and
  // its checkpointed state into an independent workspace window instead.
  if (isTauriRuntime()) {
    items.push({ kind: "item", id: "pane-open-window", text: "Open in New Window", action: () => { void openNativePageWindow(tab); } });
    if (canTransferNativeTab(tab.id)) items.push({ kind: "item", id: "pane-move-window", text: "Move to New Window", action: () => { void moveNativeTab(tab.id); } });
  }
  return items;
}
