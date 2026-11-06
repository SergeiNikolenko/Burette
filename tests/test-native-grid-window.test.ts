import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
const browser = new Window({ url: "http://localhost/" });
for (const key of ["window", "document", "HTMLElement", "Element", "Node", "CSS", "MessageEvent", "localStorage"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { captureNativeGridTab, restoreNativeGridTab } = await import("../apps/desktop/src/components/workspace-panes/native-grid-window");
const { isGridDocumentCloseTransitionActive, replayPendingGridCloseTransitionRequests } = await import("../apps/desktop/src/lib/window-mutation-barrier");

test("grid handoff freezes capture and checks loaded baseline before applying edits", async () => {
  const frame = document.createElement("iframe");
  frame.className = "viewer-iframe"; frame.dataset.documentId = "grid"; frame.dataset.renderer = "grid2d";
  document.body.append(frame);
  const requests: string[] = [];
  let version = "original-index-hash";
  mockIPC((command, args) => {
    if (command !== "grid_transfer_source_version") throw new Error(`Unexpected command ${command}`);
    expect(args).toEqual({ documentId: "grid" });
    return version;
  });
  const target = frame.contentWindow!;
  target.postMessage = (message: any) => {
    requests.push(message.body.type);
    const requestId = message.body.requestId;
    if (!requestId) return;
    queueMicrotask(() => window.dispatchEvent(new MessageEvent("message", {
      source: target,
      data: { source: "burette-grid", body: message.body.type === "gridCloseTransitionChanged"
        ? { type: "gridCloseTransitionAcknowledged", requestId, active: true }
        : { type: "gridWindowResult", requestId, ok: true, snapshot: "serialized live edits" } },
    })));
  };
  useMoleculeStore.setState({ documents: [{ id: "grid", path: "/collection.csv", renderer: "grid2d" } as any] });
  try {
    const captured = await captureNativeGridTab({ id: "tab", location: { kind: "file", documentId: "grid", path: "/collection.csv" }, back: [], forward: [] });
    expect(captured.value).toEqual({ sourceVersion: "original-index-hash", snapshot: "serialized live edits" });
    expect(isGridDocumentCloseTransitionActive("grid")).toBe(true);
    captured.release();
    expect(isGridDocumentCloseTransitionActive("grid")).toBe(false);
    version = "changed-before-transfer";
    await expect(restoreNativeGridTab("grid", captured.value)).rejects.toThrow("source file changed");
    expect(requests).not.toContain("gridWindowRestore");
    version = captured.value.sourceVersion;
    await restoreNativeGridTab("grid", captured.value);
    expect(requests.at(-1)).toBe("gridWindowRestore");
  } finally { frame.remove(); clearMocks(); }
});

test("an inactive restored grid is activated and ready before its native baseline is captured", async () => {
  const tab = { id: "cold-tab", location: { kind: "file" as const, documentId: "cold-grid", path: "/cold.csv" }, back: [], forward: [] };
  const notes = { id: "notes", location: { kind: "launcher" as const }, back: [], forward: [] };
  useMoleculeStore.setState({ tabs: [notes, tab], activeTabId: notes.id,
    documents: [{ id: "cold-grid", path: "/cold.csv", renderer: "grid2d", runtimeDeferred: true } as any] });
  const frame = document.createElement("iframe");
  frame.className = "viewer-iframe"; frame.dataset.documentId = "cold-grid"; frame.dataset.renderer = "grid2d";
  const events: string[] = [];
  const unsubscribe = useMoleculeStore.subscribe(state => {
    if (state.activeTabId !== tab.id || frame.isConnected) return;
    events.push("activate");
    document.body.append(frame);
    const target = frame.contentWindow!;
    target.postMessage = (message: any) => {
      if (!message.body.requestId) return;
      events.push(message.body.type);
      queueMicrotask(() => window.dispatchEvent(new MessageEvent("message", { source: target,
        data: { source: "burette-grid", body: message.body.type === "gridCloseTransitionChanged"
          ? { type: "gridCloseTransitionAcknowledged", requestId: message.body.requestId, active: true }
          : { type: "gridWindowResult", requestId: message.body.requestId, ok: true, snapshot: "restored view" } },
      })));
    };
  });
  mockIPC(command => {
    if (command !== "grid_transfer_source_version") throw new Error(`Unexpected command ${command}`);
    expect(events).toEqual(["activate", "gridWindowReady", "gridCloseTransitionChanged"]);
    events.push("native-baseline");
    return "loaded-index-hash";
  });
  try {
    const capture = await captureNativeGridTab(tab);
    expect({ value: capture.value, events, active: useMoleculeStore.getState().activeTabId })
      .toEqual({ value: { sourceVersion: "loaded-index-hash", snapshot: "restored view" },
        events: ["activate", "gridWindowReady", "gridCloseTransitionChanged", "native-baseline", "gridWindowCapture"], active: tab.id });
    capture.release();
  } finally { unsubscribe(); frame.remove(); clearMocks(); }
});

test("cancelling cold grid capture restores focus and ignores a late native baseline", async () => {
  const tab = { id: "cold-tab", location: { kind: "file" as const, documentId: "cold-grid", path: "/cold.csv" }, back: [], forward: [] };
  const notes = { id: "notes", location: { kind: "launcher" as const }, back: [], forward: [] };
  useMoleculeStore.setState({ tabs: [notes, tab], activeTabId: notes.id,
    documents: [{ id: "cold-grid", path: "/cold.csv", renderer: "grid2d" } as any] });
  const frame = document.createElement("iframe");
  frame.className = "viewer-iframe"; frame.dataset.documentId = "cold-grid"; frame.dataset.renderer = "grid2d";
  document.body.append(frame);
  const requests: string[] = [];
  const target = frame.contentWindow!;
  target.postMessage = (message: any) => {
    requests.push(message.body.type);
    if (!message.body.requestId) return;
    queueMicrotask(() => window.dispatchEvent(new MessageEvent("message", { source: target,
      data: { source: "burette-grid", body: message.body.type === "gridCloseTransitionChanged"
        ? { type: "gridCloseTransitionAcknowledged", requestId: message.body.requestId, active: true }
        : { type: "gridWindowResult", requestId: message.body.requestId, ok: true } },
    })));
  };
  let finish!: (hash: string) => void;
  mockIPC(() => new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController();
  try {
    const capture = captureNativeGridTab(tab, controller.signal);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(finish).toBeDefined();
    controller.abort(new Error("Cancelled transfer"));
    await expect(capture).rejects.toThrow("Cancelled transfer");
    finish("late-baseline"); await new Promise(resolve => setTimeout(resolve, 0));
    expect({ ids: useMoleculeStore.getState().tabs.map(item => item.id), active: useMoleculeStore.getState().activeTabId,
      locked: isGridDocumentCloseTransitionActive("cold-grid"), captured: requests.includes("gridWindowCapture") })
      .toEqual({ ids: ["notes", "cold-tab"], active: "notes", locked: false, captured: false });
  } finally { frame.remove(); clearMocks(); }
});

test("cancelling while the grid lock is awaiting acknowledgement leaves the grid editable", async () => {
  const tab = { id: "grid-tab", location: { kind: "file" as const, documentId: "grid-lock", path: "/grid.csv" }, back: [], forward: [] };
  useMoleculeStore.setState({ tabs: [tab], activeTabId: tab.id,
    documents: [{ id: "grid-lock", path: "/grid.csv", renderer: "grid2d" } as any] });
  const frame = document.createElement("iframe");
  frame.className = "viewer-iframe"; frame.dataset.documentId = "grid-lock"; frame.dataset.renderer = "grid2d";
  document.body.append(frame);
  const target = frame.contentWindow!;
  const locks: boolean[] = [];
  let signalLock!: () => void;
  const firstLock = new Promise<void>(resolve => { signalLock = resolve; });
  target.postMessage = (message: any) => {
    const { type, active, requestId } = message.body;
    if (type === "gridCloseTransitionChanged") {
      locks.push(active);
      if (requestId) signalLock();
    }
    if (type === "gridWindowReady") queueMicrotask(() => window.dispatchEvent(new MessageEvent("message", {
      source: target,
      data: { source: "burette-grid", body: { type: "gridWindowResult", requestId, ok: true } },
    })));
  };
  const controller = new AbortController();
  try {
    const capture = captureNativeGridTab(tab, controller.signal);
    await firstLock;
    controller.abort(new Error("Cancelled transfer"));
    await expect(capture).rejects.toThrow("Cancelled transfer");
    replayPendingGridCloseTransitionRequests(frame);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(locks).toEqual([true, true, false]);
    expect(frame.inert).toBe(false);
  } finally { frame.remove(); }
});
