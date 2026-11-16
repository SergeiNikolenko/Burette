import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
const browser = new Window({ url: "http://localhost" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "CSS", "MutationObserver", "localStorage"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let listener: (event: { payload: any }) => Promise<void>;
const sent: any[] = [];
const nativeCommands: string[] = [];
mock.module("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main", listen: async (_: string, receive: typeof listener) => { listener = receive; return () => {}; } }), Window: { getByLabel: async () => ({ close: async () => {} }) } }));
mock.module("@tauri-apps/api/core", () => ({ transformCallback: () => 0, isTauri: () => true, convertFileSrc: (path: string) => path, invoke: async (command: string, args: any) => {
  nativeCommands.push(command);
  if (command === "relay_workspace_page") sent.push(args);
} }));
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => true, trackTauriListener: () => () => {} }));
mock.module("../apps/desktop/src/components/ui/toast", () => ({ toast: { add() {} } }));
const { createRoot } = await import("react-dom/client");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { openNativePageWindow, useNativePageWindowSession } = await import("../apps/desktop/src/components/workspace-panes/native-page-window");
const actions = { openPaths: async () => {}, openTextPaths: async () => {} } as any;
function Fixture() {
  useNativePageWindowSession(actions);
  const tabs = useMoleculeStore(state => state.tabs);
  return <>{tabs.map(tab => <div key={tab.id} className="page-surface" data-view-id={tab.id} data-workspace-visible="true" />)}</>;
}

test("existing-window move waits for the receiver and restores pin, label and history", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const source = { id: "source", location: { kind: "jobs" as const }, title: "Long calculation", pinned: true, back: [{ kind: "chemical-space" as const, collectionPath: "/history.sdf" }], forward: [] };
  useMoleculeStore.setState({ tabs: [source], activeTabId: source.id, documents: [], textDocuments: [] });
  try {
    await act(async () => root.render(<Fixture />));
    let done = false;
    const result = openNativePageWindow(source, { targetWindow: "existing", move: true }).then(ok => { done = true; return ok; });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    const offer = sent.at(-1);
    expect(offer.target).toBe("existing");
    expect(nativeCommands).not.toContain("open_new_workspace_window");
    expect(offer.message.placement).toEqual({ title: source.title, index: 0, pinned: true, back: [{ kind: "chemical-space", path: "/history.sdf" }], forward: [] });
    expect(useMoleculeStore.getState().tabs).toEqual([source]);
    await act(async () => listener({ payload: { kind: "ready", id: offer.message.id, from: "wrong-window" } }));
    expect(done).toBe(false);
    await act(async () => listener({ payload: { kind: "ready", id: offer.message.id, from: "existing" } }));
    expect(done).toBe(false);
    expect(useMoleculeStore.getState().tabs).toEqual([source]);
    expect(sent.at(-1).message.kind).toBe("commit");
    await act(async () => listener({ payload: { kind: "committed", id: offer.message.id, from: "existing" } }));
    expect(await result).toBe(true);
    expect(useMoleculeStore.getState().tabs.some(tab => tab.id === source.id)).toBe(false);
    // Run the real receive/placement path against an independent empty workspace state.
    await act(async () => useMoleculeStore.setState({ tabs: [], activeTabId: null, documents: [], textDocuments: [] }));
    let receipt!: Promise<void>;
    await act(async () => { receipt = listener({ payload: { ...offer.message, id: "receive-copy", from: "other-source" } }); });
    await act(async () => receipt);
    expect(sent.at(-1).message.kind).toBe("ready");
    expect(document.body.inert).toBe(true);
    await act(async () => listener({ payload: { kind: "commit", id: "receive-copy", from: "other-source" } }));
    expect(sent.at(-1).message.kind).toBe("committed");
    expect(document.body.inert).toBe(false);
    const received = useMoleculeStore.getState().tabs.find(tab => tab.location.kind === "jobs")!;
    expect({ title: received.title, pinned: received.pinned, back: received.back, forward: received.forward }).toEqual({ title: source.title, pinned: true, back: source.back, forward: [] });
    const committedTabs = useMoleculeStore.getState().tabs;
    let abortedReceipt!: Promise<void>;
    await act(async () => { abortedReceipt = listener({ payload: { ...offer.message, id: "abort-copy", from: "other-source" } }); });
    await act(async () => abortedReceipt);
    expect(sent.at(-1).message.kind).toBe("ready");
    expect(useMoleculeStore.getState().tabs.length).toBe(committedTabs.length + 1);
    await act(async () => listener({ payload: { ...offer.message, id: "concurrent-copy", from: "other-source" } }));
    expect(sent.at(-1).message.kind).toBe("failed");
    await act(async () => listener({ payload: { kind: "abort", id: "abort-copy", from: "other-source" } }));
    expect(useMoleculeStore.getState().tabs).toEqual(committedTabs);
    expect(document.body.inert).toBe(false);
    const point = document.elementFromPoint;
    document.elementFromPoint = () => null;
    await act(async () => listener({ payload: { ...offer.message, id: "outside-strip", from: "other-source", targetPosition: { x: 100, y: 100 }, targetViewportWidth: 800 } }));
    expect(sent.at(-1).message.kind).toBe("failed");
    expect(useMoleculeStore.getState().tabs).toEqual(committedTabs);
    const emptyStrip = document.createElement("div");
    emptyStrip.className = "tab-strip"; emptyStrip.dataset.workspaceGroup = "right";
    document.body.append(emptyStrip);
    document.elementFromPoint = () => emptyStrip;
    let paneReceipt!: Promise<void>;
    await act(async () => { paneReceipt = listener({ payload: { ...offer.message, id: "empty-pane", from: "other-source", targetPosition: { x: 100, y: 10 }, targetViewportWidth: 800 } }); });
    await act(async () => paneReceipt);
    expect(sent.at(-1).message.kind).toBe("ready");
    expect(useMoleculeStore.getState().tabs.filter(tab => tab.pane === "right")).toHaveLength(1);
    await act(async () => listener({ payload: { kind: "abort", id: "empty-pane", from: "other-source" } }));
    expect(useMoleculeStore.getState().tabs).toEqual(committedTabs);
    emptyStrip.remove();
    document.elementFromPoint = point;
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test("rollback owns only transfer paths even when loading partially fails or Finder opens another tab", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const originalOpen = actions.openPaths;
  const existing = { id: "existing", location: { kind: "jobs" as const }, back: [], forward: [] };
  const openTab = (path: string) => useMoleculeStore.getState().openScreenTab({ kind: "file", path }, null, { newTab: true });
  try {
    useMoleculeStore.setState({ tabs: [existing], activeTabId: existing.id, documents: [], textDocuments: [] });
    await act(async () => root.render(<Fixture />));
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    actions.openPaths = async () => {
      openTab("/transfer.sdf");
      await pending;
    };
    let receipt!: Promise<void>;
    await act(async () => { receipt = listener({ payload: {
      kind: "open", id: "cancel-during-load", from: "source", location: { kind: "chemical-space", path: "/transfer.sdf" },
    } }); });
    await act(async () => openTab("/finder.sdf"));
    await act(async () => listener({ payload: { kind: "abort", id: "cancel-during-load", from: "source" } }));
    await act(async () => { release(); await receipt; });
    expect(useMoleculeStore.getState().tabs.map(tab => tab.location)).toEqual([{ kind: "jobs" }, { kind: "file", path: "/finder.sdf" }]);
    expect(sent.at(-1).message.kind).toBe("failed");
    expect(document.body.inert).toBe(false);

    actions.openPaths = async () => {
      openTab("/partial.sdf");
      openTab("/finder-second.sdf");
      throw new Error("Second source could not be opened");
    };
    await act(async () => listener({ payload: {
      kind: "open", id: "partial-failure", from: "source", location: { kind: "chemical-space", path: "/partial.sdf" },
    } }));
    expect(useMoleculeStore.getState().tabs.map(tab => tab.location)).toEqual([
      { kind: "jobs" }, { kind: "file", path: "/finder.sdf" }, { kind: "file", path: "/finder-second.sdf" },
    ]);
    expect(sent.at(-1).message.kind).toBe("failed");
    expect(document.body.inert).toBe(false);
  } finally { actions.openPaths = originalOpen; await act(async () => root.unmount()); container.remove(); }
});
