import { expect, test } from "bun:test";
import { Window } from "happy-dom";
const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "CustomEvent"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: browser.localStorage });
const { dockScreenLocation } = await import("../apps/desktop/src/components/workspace-panes/dock-screen");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { serializeLocation, deserializeLocation } = await import("../apps/desktop/src/components/editor-area/page-kinds");

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
