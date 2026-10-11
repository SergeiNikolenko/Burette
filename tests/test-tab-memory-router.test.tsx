import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
const browser = new Window({ url: "http://localhost/?devFiles=sample.sdf" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MutationObserver", "localStorage"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { useNavigate, useLocation } = await import("react-router");
const { useMoleculeStore, getMoleculeSessionSnapshot, adjacentMainTabId } = await import("../apps/desktop/src/stores/molecule-store");
const { TabMemoryRouter } = await import("../apps/desktop/src/components/editor-area/tab-router");

test("router navigation shares tab history, session restore, and native Back/Forward without changing browser URL", async () => {
  const store = useMoleculeStore;
  store.getState().closeAllDocuments();
  store.getState().openSettingsSection("general");
  const tabId = store.getState().activeTabId!;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  function Probe() {
    const navigate = useNavigate();
    const location = useLocation();
    return <>
      <output>{location.pathname}</output>
      <button onClick={() => navigate("/settings/appearance")}>Appearance</button>
      <button onClick={() => navigate("/settings/keyboard", { replace: true })}>Keyboard</button>
      <button onClick={() => navigate(-1)}>Back</button>
      <button onClick={() => navigate(1)}>Forward</button>
    </>;
  }
  function Surface() {
    const tab = store(state => state.tabs.find(item => item.id === tabId)!);
    return <TabMemoryRouter tab={tab}><Probe /></TabMemoryRouter>;
  }
  const click = async (label: string) => act(async () => {
    Array.from(container.querySelectorAll("button")).find(button => button.textContent === label)!.click();
  });
  const route = () => container.querySelector("output")!.textContent;
  try {
    await act(async () => root.render(<Surface />));
    await click("Appearance");
    expect(route()).toBe("/settings/appearance");
    await click("Keyboard");
    expect(route()).toBe("/settings/keyboard");
    expect(store.getState().tabs.find(tab => tab.id === tabId)!.back).toEqual([{ kind: "settings", section: "general" }]);
    await act(async () => store.getState().navigateBack());
    expect(route()).toBe("/settings/general");
    await click("Forward");
    expect(route()).toBe("/settings/keyboard");
    const snapshot = getMoleculeSessionSnapshot(store.getState());
    await click("Back");
    await act(async () => store.getState().restoreSession(snapshot.tabs, snapshot.activeIndex));
    expect(route()).toBe("/settings/keyboard");
    expect(window.location.href).toBe("http://localhost/?devFiles=sample.sdf");
  } finally {
    await act(async () => root.unmount()); container.remove();
  }
});


test("cycling the main strip preserves side and floating screens", () => {
  const store = useMoleculeStore;
  store.getState().closeAllDocuments();
  store.getState().openScreenTab({ kind: "jobs" }, "side");
  store.getState().openScreenTab({ kind: "chemical-space" }, "floating");
  store.getState().openSettingsSection("general");
  store.getState().activateLastNonSettingsTab();
  store.getState().openScreenTab({ kind: "ketcher" });
  store.getState().openNewTab();
  const initial = store.getState();
  const panes = initial.tabs.filter(tab => tab.pane).map(tab => ({ id: tab.id, pane: tab.pane }));
  const mainIds = initial.tabs.filter(tab => !tab.pane && tab.location.kind !== "settings").map(tab => tab.id);
  expect(mainIds.length).toBe(2);
  for (const offset of [1, -1] as const) {
    store.getState().setActiveTab(mainIds[0]);
    for (const expected of [mainIds[1], mainIds[0]]) {
      const { tabs, activeTabId } = store.getState();
      const nextId = adjacentMainTabId(tabs, activeTabId, offset)!;
      store.getState().setActiveTab(nextId);
      expect(store.getState().activeTabId).toBe(expected);
      expect(store.getState().tabs.filter(tab => tab.pane).map(tab => ({ id: tab.id, pane: tab.pane }))).toEqual(panes);
    }
  }
});


test("reopening named screens and files preserves their labels without renaming unrelated tabs", async () => {
  const { reopenClosedTab } = await import("../apps/desktop/src/components/workspace-panes/pane-actions");
  const store = useMoleculeStore;
  store.getState().closeAllDocuments();
  store.getState().openScreenTab({ kind: "jobs" }, "side");
  const jobs = store.getState().tabs.find(tab => tab.location.kind === "jobs")!;
  store.getState().renameTab(jobs.id, "My calculations");
  store.getState().closeTab(jobs.id);
  await reopenClosedTab({ openStructurePaths: () => {}, openTextPaths: () => {} });
  expect(store.getState().tabs.filter(tab => tab.location.kind === "jobs").map(tab => ({ title: tab.title, pane: tab.pane })))
    .toEqual([{ title: "My calculations", pane: "side" }]);

  const molecule = { id: "named-file", path: "/example.pdb", title: "example.pdb", extension: "pdb", renderer: "molstar" as const, runtimePath: "", byteCount: 1 };
  store.getState().addDocuments([molecule]);
  const fileId = store.getState().activeTabId!;
  store.getState().renameTab(fileId, "Binding site");
  store.getState().closeTab(fileId);
  await reopenClosedTab({ openTextPaths: () => {}, openStructurePaths: async () => {
    // A different tab may appear while the document is being read.
    store.getState().openScreenTab({ kind: "chemical-space" });
    store.getState().addDocuments([molecule]);
  } });
  expect(store.getState().tabs.filter(tab => tab.location.kind === "file").map(tab => tab.title)).toEqual(["Binding site"]);
  expect(store.getState().tabs.find(tab => tab.location.kind === "chemical-space")?.title).toBeUndefined();
  expect(store.getState().documents[0].title).toBe("example.pdb");
});
