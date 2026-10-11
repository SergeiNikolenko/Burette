import type { MouseEvent } from "react";
import type { ShellActions, ShellViewState } from "../types";
import type { MenuItemSpec } from "../menu-types";
import { showNativeContextMenu } from "../native-context-menu";
import { menuSections } from "../workspace-menu-items";
import { pageKind } from "../editor-area/page-kinds";
import { TabKindIcon } from "../editor-area/tab-kind-icon";
import { MarqueeName } from "../marquee-name";
import { ChevronDown } from "../ui/app-icons";
import { Button } from "../ui/button";
import { isMainTab, type MoleculeTab, type TabPane } from "../../stores/molecule-store";
import { SCREEN_ENTRIES, openScreen, paneMoveItems, placeScreen, showSideScreen } from "./pane-actions";

// The "Codex ⌄" control of a pane header: the screen's glyph and title, and a
// menu to show another screen in this pane or move this one elsewhere.
export function PaneSwitcher({ pane, tab, state, actions }: {
  pane: TabPane;
  tab: MoleculeTab;
  state: ShellViewState;
  actions: ShellActions;
}) {
  const title = pageKind(tab.location).title(tab.location, state);
  const open = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    void showNativeContextMenu(paneSwitcherItems(pane, tab, state, actions), { x: rect.left, y: rect.bottom + 4 }, { presentation: "dropdown" });
  };
  return (
    <Button type="button" variant="ghost" size="toolbar" className="pane-switcher" onPointerDown={(event) => event.stopPropagation()} onClick={open} aria-label={`${title}, switch screen`}>
      <span className="pane-switcher-icon" aria-hidden><TabKindIcon location={tab.location} state={state} /></span>
      <MarqueeName className="pane-switcher-title">{title}</MarqueeName>
      <ChevronDown className="pane-switcher-chevron" size={12} aria-hidden />
    </Button>
  );
}

function screenRow(candidate: MoleculeTab, state: ShellViewState, current: MoleculeTab, select: () => void): MenuItemSpec {
  return {
    kind: "checkbox",
    id: `pane-screen-${candidate.id}`,
    text: pageKind(candidate.location).title(candidate.location, state),
    checked: candidate.id === current.id,
    action: select,
  };
}

export function paneSwitcherItems(pane: TabPane, tab: MoleculeTab, state: ShellViewState, actions: ShellActions): MenuItemSpec[] {
  // The side panel switches among its own screens; the floating window holds
  // one screen and takes any open tab in exchange.
  const here = state.tabs.filter((candidate) => candidate.pane === pane);
  const elsewhere = state.tabs.filter((candidate) => isMainTab(candidate) || (pane === "floating" && candidate.pane === "side"));
  const screens = here.map((candidate) => screenRow(candidate, state, tab, () => {
    if (pane === "side") showSideScreen(candidate.id);
  }));
  const bring: MenuItemSpec[] = elsewhere.map((candidate) => ({
    kind: "item",
    id: `pane-bring-${candidate.id}`,
    text: pageKind(candidate.location).title(candidate.location, state),
    action: () => placeScreen(candidate.id, pane),
  }));
  const open: MenuItemSpec[] = SCREEN_ENTRIES
    .filter((entry) => !state.tabs.some((candidate) => candidate.pane === pane && candidate.location.kind === entry.location.kind))
    .map((entry) => ({ kind: "item", id: `pane-open-${entry.id}`, text: entry.text, action: () => openScreen(entry.location, pane) }));
  return menuSections(
    screens,
    bring.length ? [{ kind: "submenu", id: "pane-bring", text: pane === "side" ? "Show Tab Here" : "Show Tab in Window", items: bring }] : [],
    open.length ? [{ kind: "submenu", id: "pane-open", text: "Open", items: open }] : [],
    paneMoveItems(tab),
    [{ kind: "item", id: "pane-close-screen", text: "Close", action: () => { void actions.closeTab(tab.id); } }],
  );
}
