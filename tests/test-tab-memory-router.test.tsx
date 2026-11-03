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

test("reopen restores order, pinned placement, history, and renderer without changing a concurrent tab", async () => {
  const { reopenClosedTab } = await import("../apps/desktop/src/components/workspace-panes/pane-actions");
  const { takeClosedTab } = await import("../apps/desktop/src/stores/closed-tabs");
  while (takeClosedTab()) { /* Isolate user close history. */ }
  const document = { id: "reopen-original", path: "/reopen.xyz", title: "reopen.xyz", extension: "xyz", renderer: "xyzrender-external" as const, runtimePath: "", byteCount: 1 };
  const tab = {
    id: "reopen-view", title: "My pose", pinned: true, pane: "bottom" as const,
    location: { kind: "file" as const, documentId: document.id, path: document.path },
    back: [{ kind: "jobs" as const }], forward: [{ kind: "chemical-space" as const }],
  };
  const retained = { id: "retained", location: { kind: "jobs" as const }, back: [], forward: [] };
  useMoleculeStore.setState({ documents: [document], tabs: [tab, retained], activeTabId: tab.id });
  useMoleculeStore.getState().closeTab(tab.id);
  const requests: unknown[] = [];
  await reopenClosedTab({ openTextPaths: () => {}, openStructurePaths: async (paths, options) => {
    requests.push([paths, options]);
    useMoleculeStore.getState().openScreenTab({ kind: "chemical-space" }, null, { newTab: true });
    useMoleculeStore.getState().addDocuments([{ ...document, id: "reloaded-id" }]);
  } });
  const restored = useMoleculeStore.getState().tabs[0];
  expect({ ...restored, id: tab.id, location: { ...restored.location, documentId: document.id } }).toEqual(tab);
  expect(requests).toEqual([[[document.path], { rendererMode: "xyzrender-external" }]]);
  expect(useMoleculeStore.getState().tabs.find(current => current.id === retained.id)).toEqual(retained);
  useMoleculeStore.getState().navigateTabHistory(restored.id, -1);
  expect(useMoleculeStore.getState().tabs[0].location).toEqual({ kind: "jobs" });
});

test("failed reopen remains retryable and rapid reopen requests are serialized", async () => {
  const { reopenClosedTab } = await import("../apps/desktop/src/components/workspace-panes/pane-actions");
  const { takeClosedTab } = await import("../apps/desktop/src/stores/closed-tabs");
  while (takeClosedTab()) { /* Isolate user close history. */ }
  useMoleculeStore.getState().closeAllDocuments();
  const document = { id: "retry", path: "/retry.pdb", title: "retry.pdb", extension: "pdb", renderer: "molstar" as const, runtimePath: "", byteCount: 1 };
  useMoleculeStore.getState().addDocuments([document]);
  useMoleculeStore.getState().closeActiveDocument();
  await reopenClosedTab({ openTextPaths: () => {}, openStructurePaths: async () => { throw new Error("unavailable"); } });
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const opened: string[] = [];
  const actions = { openTextPaths: () => {}, openStructurePaths: async () => {
    opened.push(document.path);
    await wait;
    useMoleculeStore.getState().addDocuments([document]);
  } };
  const first = reopenClosedTab(actions);
  const second = reopenClosedTab(actions);
  await Promise.resolve();
  expect(opened).toEqual([document.path]);
  release();
  await Promise.all([first, second]);
  expect(useMoleculeStore.getState().tabs.filter(tab => tab.location.kind === "file")).toHaveLength(1);
  expect(takeClosedTab()).toBeUndefined();
});

test("sidebar previews replace clean views per pane, promote dirty/explicit views, and stay out of persisted sessions", async () => {
  browser.happyDOM.setURL("https://burette.test/");
  const { openSidebarFile } = await import("../apps/desktop/src/lib/sidebar-file-preview");
  const { getMoleculeSessionSnapshot } = await import("../apps/desktop/src/stores/molecule-store");
  const { takeClosedTab } = await import("../apps/desktop/src/stores/closed-tabs");
  while (takeClosedTab()) { /* Isolate close history. */ }
  useMoleculeStore.getState().closeAllDocuments();
  const actions = {
    openPaths: async (paths: string[]) => { useMoleculeStore.getState().addDocuments(paths.map(path => ({ id: path, path, title: path, extension: "pdb", renderer: "molstar" as const, runtimePath: "", byteCount: 1 }))); },
    closeTab: (id: string) => useMoleculeStore.getState().closeTab(id),
    selectTab: (id: string) => useMoleculeStore.getState().setActiveTab(id),
  };
  await openSidebarFile("/preview-a.pdb", false, () => actions, () => false, () => true);
  expect(useMoleculeStore.getState().tabs.filter(tab => tab.preview)).toHaveLength(1);
  expect(getMoleculeSessionSnapshot(useMoleculeStore.getState()).tabs).toHaveLength(0);
  expect(JSON.parse(localStorage.getItem(useMoleculeStore.persist.getOptions().name)!).state.tabs).toHaveLength(0);
  await openSidebarFile("/preview-b.pdb", false, () => actions, () => false, () => true);
  expect(useMoleculeStore.getState().tabs.filter(tab => tab.preview).map(tab => tab.location)).toEqual([{ kind: "file", path: "/preview-b.pdb", documentId: "/preview-b.pdb" }]);
  expect(takeClosedTab()).toBeUndefined();
  await openSidebarFile("/preview-c.pdb", false, () => actions, () => true, () => true);
  expect(useMoleculeStore.getState().tabs.map(tab => ["path" in tab.location && tab.location.path, Boolean(tab.preview)])).toEqual([["/preview-b.pdb", false], ["/preview-c.pdb", true]]);
  await openSidebarFile("/preview-c.pdb", true, () => actions, () => false, () => true);
  expect(useMoleculeStore.getState().tabs.some(tab => tab.preview)).toBe(false);
  expect(getMoleculeSessionSnapshot(useMoleculeStore.getState()).tabs).toHaveLength(2);
  useMoleculeStore.getState().placeTab(useMoleculeStore.getState().activeTabId!, "right");
  await openSidebarFile("/preview-right.pdb", false, () => actions, () => false, () => true);
  useMoleculeStore.getState().setActiveTab(useMoleculeStore.getState().tabs.find(tab => tab.location.kind === "file" && tab.location.path === "/preview-b.pdb")!.id);
  await openSidebarFile("/preview-main.pdb", false, () => actions, () => false, () => true);
  expect(useMoleculeStore.getState().tabs.filter(tab => tab.preview).map(tab => tab.pane ?? "main").sort()).toEqual(["main", "right"]);
});

test("reopening a grid publishes its view mode before the viewer can mount", async () => {
  const { reopenClosedTab } = await import("../apps/desktop/src/components/workspace-panes/pane-actions");
  const { takeClosedTab } = await import("../apps/desktop/src/stores/closed-tabs");
  while (takeClosedTab()) { /* Isolate close history. */ }
  const doc = { id: "closed-grid", path: "/closed.csv", title: "closed.csv", extension: "csv", renderer: "grid2d" as const, runtimePath: "", byteCount: 1 };
  const tab = { id: "closed-grid-tab", location: { kind: "file" as const, path: doc.path, documentId: doc.id, gridViewMode: "table" as const }, back: [], forward: [] };
  useMoleculeStore.setState({ documents: [doc], tabs: [tab], activeTabId: tab.id });
  useMoleculeStore.getState().closeTab(tab.id);
  const modes: unknown[] = [];
  const unsubscribe = useMoleculeStore.subscribe(state => {
    const opened = state.tabs.find(current => current.location.kind === "file" && current.location.path === doc.path);
    if (opened?.location.kind === "file") modes.push(opened.location.gridViewMode);
  });
  const actions = { openTextPaths: () => {}, openStructurePaths: async (_paths: string[], options?: { gridViewMode?: "cards" | "table" }) => {
    useMoleculeStore.getState().addDocuments([{ ...doc, id: "reopened-grid" }], options);
    await Promise.resolve();
  } };
  try {
    await reopenClosedTab(actions);
    expect(modes.length).toBeGreaterThan(0);
    expect(modes.every(mode => mode === "table")).toBe(true);
  } finally { unsubscribe(); }
  const restored = useMoleculeStore.getState().tabs.find(current => current.location.kind === "file")!;
  useMoleculeStore.getState().closeTab(restored.id);
  useMoleculeStore.getState().addDocuments([doc], { gridViewMode: "cards" });
  await reopenClosedTab(actions);
  const existing = useMoleculeStore.getState().tabs.find(current => current.location.kind === "file")!;
  expect(existing.location.kind === "file" && existing.location.gridViewMode).toBe("cards");
});
