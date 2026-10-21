import type { MenuItemSpec } from "../menu-types";
import type { ShellActions, ShellViewState } from "../types";
import { canOpenNativePopout, openNativePopout } from "./native-popout";
import { takeClosedTab } from "../../stores/closed-tabs";
import type { Location } from "../editor-area/page-kinds";
import { useMoleculeStore, type MoleculeTab, type TabPane } from "../../stores/molecule-store";
import { useWorkspacePanesStore } from "../../stores/workspace-panes-store";
import { isTauriRuntime } from "../../lib/tauri";
import { isNativePopoutTab, nativePopoutReason, popOutNativeScene, returnNativePopout as returnMovedScene } from "./native-scene-window";
import { toast } from "../ui/toast";

// Moving a screen between the main strip and the floating window. The page
// itself never remounts (see ViewerArea); these only change where its surface
// is laid out.
export function placeScreen(tabId: string, pane: TabPane | null) {
  useWorkspacePanesStore.getState().setFullView(null);
  useMoleculeStore.getState().placeTab(tabId, pane);
  if (pane === "floating") useWorkspacePanesStore.getState().setFloatingMinimized(false);
}

export function openScreen(location: Location, pane: TabPane | null = null, options?: { newTab: boolean }) {
  useMoleculeStore.getState().openScreenTab(location, pane, options);
  if (pane === "floating") useWorkspacePanesStore.getState().setFloatingMinimized(false);
}

// Codex's ⇧⌘T. Files are read again from disk because closing a tab unloads
// its document; other screens come back in the pane they were closed from.
export async function reopenClosedTab(actions: Pick<ShellActions, "openStructurePaths" | "openTextPaths">) {
  const tab = takeClosedTab();
  if (!tab) return;
  const { location } = tab;
  const existingIds = new Set(useMoleculeStore.getState().tabs.map(current => current.id));
  if (location.kind === "file") await actions.openStructurePaths([location.path]);
  else if (location.kind === "text-file") await actions.openTextPaths([location.path]);
  else openScreen(location, tab.pane ?? null);
  // Apply the label only to the restored screen, not another tab opened while
  // a file was loading or an existing screen that the open action reused.
  if (tab.title) {
    const restored = useMoleculeStore.getState().tabs.find(current => !existingIds.has(current.id) && (
      current.location === location || (
        (location.kind === "file" || location.kind === "text-file")
        && current.location.kind === location.kind && current.location.path === location.path
      )
    ));
    if (restored) useMoleculeStore.getState().renameTab(restored.id, tab.title);
  }
}

// The screens that are not files, offered by the new-tab menu and the pane
// switchers. Start page first, like Codex's "New page".
export const SCREEN_ENTRIES: { id: string; text: string; location: Location }[] = [
  { id: "screen-launcher", text: "New tab", location: { kind: "launcher" } },
  { id: "screen-jobs", text: "Jobs", location: { kind: "jobs" } },
  { id: "screen-chemical-space", text: "Chemical space", location: { kind: "chemical-space" } },
  { id: "screen-ketcher", text: "Ketcher", location: { kind: "ketcher" } },
];

// "Pop out", "Move to New Window" and "Move to Main Window" for one screen, shared by the tab context
// menu and the floating window header so they always agree.
export function paneMoveItems(tab: MoleculeTab, state: ShellViewState, actions: ShellActions): MenuItemSpec[] {
  const full = useWorkspacePanesStore.getState().fullViewTabId === tab.id;
  const items: MenuItemSpec[] = [
    { kind: "item", id: "pane-full-view", text: full ? "Exit Full View" : "Enter Full View", action: () => {
      useMoleculeStore.getState().setActiveTab(tab.id);
      useWorkspacePanesStore.getState().setFullView(full ? null : tab.id);
    } },
    ...(["right", "bottom"] as const).filter(pane => tab.pane !== pane).map(pane => ({
      kind: "item" as const, id: `pane-split-${pane}`, text: pane === "right" ? "Move to Right Split" : "Move to Bottom Split", action: () => placeScreen(tab.id, pane),
    })),
  ];
  if (isNativePopoutTab(tab.id)) return [{ kind: "item", id: "pane-return-main", text: "Move to Main Window", action: () => {
    void returnMovedScene().catch(() => toast.add({ title: "Could not return scene", description: "Keep this window open and try again.", type: "error" }));
  } }];
  if (tab.pane) {
    items.push({ kind: "item", id: "pane-move-main", text: "Move to Main Tabs", action: () => placeScreen(tab.id, null) });
  }
  if (canOpenNativePopout(tab) || tab.pane !== "floating") {
    items.push({ kind: "item", id: "pane-pop-out", text: "Pop out", action: async () => {
      if (canOpenNativePopout(tab)) {
        if (await openNativePopout(tab, state, actions)) placeScreen(tab.id, null);
      } else placeScreen(tab.id, "floating");
    } });
  }
  // Pop out copies the scene into a compact preview; this moves the scene and
  // its checkpointed state into an independent workspace window instead.
  if (isTauriRuntime() && !tab.pane) {
    const reason = nativePopoutReason(tab);
    items.push({ kind: "item", id: "pane-move-window", text: "Move to New Window", disabled: Boolean(reason), tooltip: reason ?? undefined, action: () => { void popOutNativeScene(tab.id); } });
  }
  return items;
}
