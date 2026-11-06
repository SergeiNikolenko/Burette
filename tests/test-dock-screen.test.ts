import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { MoleculeTab } from "../apps/desktop/src/stores/molecule-store";
import type { ShellActions, ShellViewState } from "../apps/desktop/src/components/types";
const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "CustomEvent"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: browser.localStorage });
const { dockScreenLocation } = await import("../apps/desktop/src/components/workspace-panes/dock-screen");
const { useMoleculeStore, adjacentMainTabId } = await import("../apps/desktop/src/stores/molecule-store");
const { serializeLocation, deserializeLocation } = await import("../apps/desktop/src/components/editor-area/page-kinds");
const { paneSwitcherItems } = await import("../apps/desktop/src/components/workspace-panes/pane-switcher");
const { useWorkspacePanesStore } = await import("../apps/desktop/src/stores/workspace-panes-store");
const { reconcileGroupSelections } = await import("../apps/desktop/src/lib/group-selection");

test("workspace tools pin their input and retain it after the source tab closes", () => {
  const source = { id: "collection", path: "/collection.sdf", renderer: "grid2d" };
  const state = { activeDocument: source, documents: [source], textDocuments: [], rightDockDocumentId: null } as any;
  const analysis = dockScreenLocation("right", "chemical-space", state)!;
  const info = dockScreenLocation("right", "inspector", state)!;
  expect(analysis).toEqual({ kind: "chemical-space", collectionPath: source.path });
  expect(deserializeLocation(serializeLocation(info))).toEqual(info);
  useMoleculeStore.setState({ tabs: [], documents: [source] as any });
  useMoleculeStore.getState().openScreenTab({ kind: "file", path: source.path, documentId: source.id });
  const fileTab = useMoleculeStore.getState().activeTabId!;
  useMoleculeStore.getState().openScreenTab(analysis, "right");
  useMoleculeStore.getState().openScreenTab(info, "bottom");
  useMoleculeStore.getState().closeTab(fileTab);
  expect(useMoleculeStore.getState().documents).toEqual([source]);
  expect(useMoleculeStore.getState().tabs.filter(tab => tab.location.kind !== "launcher").map(tab => tab.pane)).toEqual(["right", "bottom"]);
});

test("explicit new screens have independent identities within the same group", () => {
  useMoleculeStore.getState().openScreenTab({ kind: "jobs" }, "right", { newTab: true });
  const first = useMoleculeStore.getState().activeTabId;
  useMoleculeStore.getState().openScreenTab({ kind: "jobs" }, "right", { newTab: true });
  expect(useMoleculeStore.getState().activeTabId).not.toBe(first);
  expect(useMoleculeStore.getState().tabs.filter(tab => tab.location.kind === "jobs").length).toBe(2);
});

test("opening an existing screen preserves its group unless a destination is specified", () => {
  const store = useMoleculeStore.getState();
  useMoleculeStore.setState({ tabs: [{ id: "main", location: { kind: "launcher" }, back: [], forward: [] }], activeTabId: "main" });
  const jobs = { kind: "jobs" } as const;
  const id = store.openScreenTab(jobs, "right");
  store.setActiveTab("main");
  expect(store.openScreenTab(jobs)).toBe(id);
  expect(useMoleculeStore.getState().tabs.find(tab => tab.id === id)?.pane).toBe("right");
  expect(useMoleculeStore.getState().activeTabId).toBe(id);
  expect(store.openScreenTab(jobs, null)).toBe(id);
  expect(useMoleculeStore.getState().tabs.find(tab => tab.id === id)?.pane).toBeUndefined();
});


test("focused group owns new tabs, cycling, reactivation and Settings return", () => {
  const store = useMoleculeStore.getState();
  store.openScreenTab({ kind: "jobs" }, "right");
  const jobs = useMoleculeStore.getState().activeTabId!;
  store.openNewTab();
  const state = useMoleculeStore.getState();
  expect(state.tabs.find(tab => tab.id === state.activeTabId)?.pane).toBe("right");
  const next = adjacentMainTabId(state.tabs, state.activeTabId, 1);
  expect(state.tabs.find(tab => tab.id === next)?.pane).toBe("right");
  store.openScreenTab({ kind: "jobs" }, "right");
  expect(useMoleculeStore.getState().activeTabId).toBe(jobs);
  store.openSettingsSection("general");
  store.activateLastNonSettingsTab();
  expect(useMoleculeStore.getState().activeTabId).toBe(jobs);
  store.openNewTab();
  store.closeActiveDocument();
  const afterClose = useMoleculeStore.getState();
  expect(afterClose.tabs.find(tab => tab.id === afterClose.activeTabId)?.pane).toBe("right");
});

test("closing selects the next surviving tab, then the previous tab, in the focused group", () => {
  const tabs: MoleculeTab[] = [
    { id: "main", location: { kind: "jobs" }, back: [], forward: [] },
    ...["a", "b", "c", "d"].map(id => ({ id, pane: "right" as const, location: { kind: "jobs" as const }, back: [], forward: [] })),
  ];
  for (const [activeTabId, closing, expected] of [
    ["b", ["b"], "c"],
    ["d", ["d"], "c"],
    ["b", ["b", "c"], "d"],
    ["c", ["b", "c", "d"], "a"],
    ["main", ["b"], "main"],
    ["b", ["a", "b", "c", "d"], "main"],
  ] as const) {
    useMoleculeStore.setState({ tabs, activeTabId, documents: [], textDocuments: [] });
    useMoleculeStore.getState().closeTabs([...closing]);
    expect(useMoleculeStore.getState().activeTabId).toBe(expected);
  }
});

test("pane menu selects existing tabs and opens independent screens without moving main tabs", () => {
  const tabs: MoleculeTab[] = [
    { id: "main-jobs", location: { kind: "jobs" }, back: [], forward: [] },
    { id: "right-jobs", pane: "right", location: { kind: "jobs" }, back: [], forward: [] },
    { id: "right-info", pane: "right", location: { kind: "tool", tool: "inspector", area: "right" }, back: [], forward: [] },
  ];
  useMoleculeStore.setState({ tabs, activeTabId: "right-info", documents: [], textDocuments: [] });
  const state = { ...useMoleculeStore.getState() } as unknown as ShellViewState;
  const actions = { selectTab: useMoleculeStore.getState().setActiveTab } as ShellActions;
  const items = paneSwitcherItems("right", tabs[2], state, actions);
  const select = items.find(item => item.kind === "checkbox" && item.id === "pane-screen-right-jobs");
  if (!select || select.kind !== "checkbox" || !select.action) throw new Error("Missing screen selection");
  select.action(true);
  expect(useMoleculeStore.getState().activeTabId).toBe("right-jobs");
  const open = items.find(item => item.kind === "submenu" && item.id === "pane-open");
  if (!open || open.kind !== "submenu") throw new Error("Missing Open menu");
  for (const id of ["pane-open-screen-files", "pane-open-screen-jobs"]) {
    const entry = open.items.find(item => item.kind === "item" && item.id === id);
    if (!entry || entry.kind !== "item" || !entry.action) throw new Error(`Missing ${id}`);
    entry.action();
  }
  const result = useMoleculeStore.getState();
  expect(result.tabs.slice(0, 3)).toEqual(tabs);
  expect(result.tabs.slice(3).map(tab => ({ pane: tab.pane, location: tab.location }))).toEqual([
    { pane: "right", location: { kind: "tool", tool: "files", area: "right" } },
    { pane: "right", location: { kind: "jobs" } },
  ]);
});

test("background group selection follows adjacent survivors without changing other groups", () => {
  const tabs: MoleculeTab[] = [
    { id: "main", location: { kind: "jobs" }, back: [], forward: [] },
    ...["a", "b", "c", "d"].map(id => ({ id, pane: "right" as const, location: { kind: "jobs" as const }, back: [], forward: [] })),
    { id: "bottom", pane: "bottom", location: { kind: "jobs" }, back: [], forward: [] },
  ];
  const selected = { main: "main", right: "c", bottom: "bottom" };
  expect(reconcileGroupSelections(tabs, tabs, selected)).toBe(selected);
  expect(reconcileGroupSelections(tabs, tabs.filter(tab => tab.id !== "c"), selected))
    .toEqual({ main: "main", right: "d", bottom: "bottom" });
  expect(reconcileGroupSelections(tabs, tabs.filter(tab => !["c", "d"].includes(tab.id)), selected))
    .toEqual({ main: "main", right: "b", bottom: "bottom" });
  expect(reconcileGroupSelections(tabs, tabs.filter(tab => tab.pane !== "right"), selected))
    .toEqual({ main: "main", bottom: "bottom" });
  const moved = tabs.map(tab => tab.id === "c" ? { ...tab, pane: "bottom" as const } : tab);
  expect(reconcileGroupSelections(tabs, moved, selected))
    .toEqual({ main: "main", right: "d", bottom: "bottom" });
  expect(reconcileGroupSelections([], tabs, { right: "missing" })).toEqual({ right: "a" });
  expect(selected).toEqual({ main: "main", right: "c", bottom: "bottom" });
});

 test("closing the last secondary tab restores the remembered main selection", () => {
  const tabs: MoleculeTab[] = [
    { id: "main-a", location: { kind: "jobs" }, back: [], forward: [] },
    { id: "main-b", location: { kind: "jobs" }, back: [], forward: [] },
    { id: "side", pane: "right", location: { kind: "jobs" }, back: [], forward: [] },
  ];
  useWorkspacePanesStore.setState({ selectedTabs: { main: "main-b", right: "side" } });
  useMoleculeStore.setState({ tabs, activeTabId: "side", documents: [], textDocuments: [] });
  useMoleculeStore.getState().closeTab("side");
  expect(useMoleculeStore.getState().activeTabId).toBe("main-b");
});
