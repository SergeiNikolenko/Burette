import type { MenuItemSpec } from "../menu-types";
import type { ShellActions, ShellViewState } from "../types";
import { canOpenNativePopout, openNativePopout } from "./native-popout";
import { takeClosedTab } from "../../stores/closed-tabs";
import type { Location } from "../editor-area/page-kinds";
import { useMoleculeStore, type MoleculeTab, type TabPane } from "../../stores/molecule-store";
import { useWorkspacePanesStore } from "../../stores/workspace-panes-store";

// Moving a screen between the main strip and the floating window. The page
// itself never remounts (see ViewerArea); these only change where its surface
// is laid out.
export function placeScreen(tabId: string, pane: TabPane | null) {
  useMoleculeStore.getState().placeTab(tabId, pane);
  if (pane === "floating") useWorkspacePanesStore.getState().setFloatingMinimized(false);
}

export function openScreen(location: Location, pane: TabPane | null = null) {
  useMoleculeStore.getState().openScreenTab(location, pane);
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

// "Pop out" and "Move to Main Window" for one screen, shared by the tab context
// menu and the floating window header so they always agree.
export function paneMoveItems(tab: MoleculeTab, state: ShellViewState, actions: ShellActions): MenuItemSpec[] {
  const items: MenuItemSpec[] = [];
  if (tab.pane) {
    items.push({ kind: "item", id: "pane-move-main", text: "Move to Main Window", action: () => placeScreen(tab.id, null) });
  }
  if (canOpenNativePopout(tab) || tab.pane !== "floating") {
    items.push({ kind: "item", id: "pane-pop-out", text: "Pop out", action: async () => {
      if (canOpenNativePopout(tab)) {
        if (await openNativePopout(tab, state, actions)) placeScreen(tab.id, null);
      } else placeScreen(tab.id, "floating");
    } });
  }
  return items;
}
