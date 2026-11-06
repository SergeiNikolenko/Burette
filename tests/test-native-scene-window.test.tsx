import { expect, mock, test } from "bun:test";
import { Window as BrowserWindow } from "happy-dom";
import React, { act } from "react";
const browser = new BrowserWindow();
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MutationObserver"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
let listener: (event: { payload: unknown }) => Promise<void>;
let latest: Record<string, any>;
let failSave = false;
let sheetArchive: object | undefined;
let savedSheet: Record<string, any> | undefined;
let writeSheet = async () => path;
let closedWindows: string[] = [];
let openIncoming = async () => {};
let readiness = async () => ({ ready: true });
const savedSources: string[] = [];
const path = "/private/popout-scenes/01234567-1234-1234-1234-123456789012.molx";
const frame = document.createElement("iframe");
const surface = document.createElement("div"); surface.className = "page-surface"; surface.append(frame); document.body.append(surface);
const doc = { id: "scene", path: "/data/protein.pdb", recoveryPath: path, title: "Protein", renderer: "molstar" };
const tab = { id: "tab", title: "Protein", location: { kind: "file", documentId: "scene", path: doc.path, recoveryPath: path } };
let state: any;
function reset() { state = { tabs: [tab], documents: [doc], setActiveDocument() {}, renameTab() {}, togglePinnedTab() {}, moveTab() {}, closeTab(id: string) { state.tabs = state.tabs.filter((item: any) => item.id !== id); } }; latest = {}; failSave = false; closedWindows = []; }
const store = Object.assign(() => {}, { getState: () => state, setState: (fn: any) => { Object.assign(state, fn(state)); } });
mock.module("../apps/desktop/src/stores/molecule-store", () => ({ useMoleculeStore: store }));
mock.module("../apps/desktop/src/lib/viewer-bridge", () => ({ activeViewerIframeForDocument: () => frame, requestViewerAction: async (_: string, action: any) => action.type === "observe_story" ? { count: 1 } : action.type === "workspace_scene_state" ? readiness() : sheetArchive ? { sheet: sheetArchive } : { dataBase64: "UEsDBA==" } }));
mock.module("../apps/desktop/src/hooks/workspace-scene-import", () => ({ focusSceneDocument: async (document: any) => {
  state.activeTabId = state.tabs.find((item: any) => item.location.documentId === document.id)?.id;
} }));
mock.module("../apps/desktop/src/components/editor-area/page-kinds", () => ({ serializeLocation: (location: unknown) => location, deserializeLocation: (location: unknown) => location }));
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => true, trackTauriListener: () => () => {} }));
mock.module("../apps/desktop/src/components/ui/toast", () => ({ toast: { add: () => {} } }));
mock.module("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "workspace-child", listen: async (_: string, receive: typeof listener) => { listener = receive; return () => {}; } }), Window: { getByLabel: async (label: string) => ({ close: async () => { closedWindows.push(label); } }) } }));
mock.module("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => path, invoke: async (command: string, args: any) => {
  if (command === "save_popout_scene") { if (failSave) throw new Error("disk full"); savedSources.push(args.sourcePath); return path; }
  if (command === "save_popout_sheet") { savedSheet = args; return writeSheet(); }
  if (command === "open_new_workspace_window") return "workspace-peer";
  if (command === "relay_popout_handoff") latest = { ...args.message, target: args.target };
} }));
const { useNativePopoutSession, popOutNativeScene, returnNativePopout, nativePopoutBusy, checkpointNativePopoutForExit, checkpointNativeScenesForClose, isNativePopoutTab } = await import("../apps/desktop/src/components/workspace-panes/native-scene-window");
function Listener() { useNativePopoutSession({ openStructurePaths: async () => openIncoming() } as any); return null; }
async function withListener(run: () => Promise<void>) {
  reset(); openIncoming = async () => {}; readiness = async () => ({ ready: true }); savedSources.length = 0;
  sheetArchive = undefined; savedSheet = undefined;
  writeSheet = async () => path;
  const mount = document.createElement("div"); document.body.append(mount); const root = createRoot(mount);
  try { await act(async () => root.render(<Listener />)); await run(); }
  finally { await act(async () => root.unmount()); mount.remove(); }
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
test("closing an unmounted restored tab keeps its existing recovery without requiring a live document", async () => withListener(async () => {
  state.documents = [];
  await checkpointNativeScenesForClose(["tab"]);
  expect(state.tabs[0].location.recoveryPath).toBe(path);
  expect(savedSheet).toBeUndefined(); expect(nativePopoutBusy()).toBe(false);
  state.documents = [{ ...doc, runtimeDeferred: true }];
  await checkpointNativeScenesForClose(["tab"]);
  expect(savedSources).toHaveLength(0); expect(state.tabs[0].location.recoveryPath).toBe(path);
}));
test("close captures a fresh sheet and restores selection before the caller removes it", async () => withListener(async () => {
  state.documents = [{ ...doc, renderer: "xyzrender-external", recoveryPath: undefined }];
  state.tabs = [{ ...tab, location: { ...tab.location, recoveryPath: undefined } }, { id: "other", location: { kind: "launcher" } }];
  state.activeTabId = "other"; state.setActiveTab = (id: string) => { state.activeTabId = id; };
  sheetArchive = { version: 1, angle: 45 };
  await checkpointNativeScenesForClose(["tab"]);
  expect(savedSheet?.sheet).toEqual(sheetArchive);
  expect(state.tabs[0].location.recoveryPath).toBe(path);
  expect(state.activeTabId).toBe("other");
  expect(state.tabs).toHaveLength(2); expect(nativePopoutBusy()).toBe(false);
}));

test("timed-out close cannot publish a late checkpoint and unlocks the viewer", async () => withListener(async () => {
  state.documents = [{ ...doc, renderer: "xyzrender-external", recoveryPath: undefined }];
  state.tabs = [{ ...tab, location: { ...tab.location, recoveryPath: undefined } }];
  sheetArchive = { version: 1, angle: 45 };
  let finishWrite!: (path: string) => void;
  writeSheet = () => new Promise(resolve => { finishWrite = resolve; });
  const closing = checkpointNativeScenesForClose(["tab"]);
  await flush(); expect(nativePopoutBusy()).toBe(true); expect(surface.inert).toBe(true);
  await expect(checkpointNativeScenesForClose(["tab"])).rejects.toThrow("Wait for the scene");
  await expect(closing).rejects.toThrow("did not finish saving");
  expect(nativePopoutBusy()).toBe(false); expect(surface.inert).not.toBe(true);
  finishWrite(path); await flush();
  expect(state.tabs[0].location.recoveryPath).toBeUndefined(); expect(state.tabs).toHaveLength(1);
}), 20000);
test("a path replacement during capture rejects the checkpoint without replacing recovery", async () => withListener(async () => {
  state.documents = [{ ...doc, renderer: "xyzrender-external" }];
  sheetArchive = { version: 1, angle: 45 };
  writeSheet = async () => {
    state.documents[0] = { ...state.documents[0], path: "/data/replacement.xyz" };
    return "/private/popout-scenes/new.xyz";
  };
  await expect(checkpointNativeScenesForClose(["tab"])).rejects.toThrow("tab changed");
  expect(state.tabs[0].location.recoveryPath).toBe(path); expect(nativePopoutBusy()).toBe(false);
}));
test("sheet checkpoint separates recovery bytes from original identity", async () => withListener(async () => {
  sheetArchive = { version: 1, items: [] };
  await checkpointNativePopoutForExit();
  expect(savedSheet?.sourcePath).toBe(doc.path);
  expect(savedSheet?.recoveryPath).toBe(doc.recoveryPath);
  expect(savedSheet?.sheet).toBe(sheetArchive);
}));
test("exit captures a fresh sheet and restores the selected non-scene tab", async () => withListener(async () => {
  const sheet = { ...doc, renderer: "xyzrender-external", recoveryPath: undefined };
  const freshTab = { ...tab, location: { ...tab.location, recoveryPath: undefined } };
  state.documents = [sheet];
  state.tabs = [freshTab, { id: "notes", location: { kind: "text-file", path: "/data/notes.txt" } }];
  state.activeTabId = "notes";
  state.setActiveTab = (id: string) => { state.activeTabId = id; };
  sheetArchive = { version: 1, items: [{ svg: "<svg/>" }] };
  await checkpointNativePopoutForExit();
  expect({ source: savedSheet?.sourcePath, sheet: savedSheet?.sheet,
    recovery: state.tabs[0].location.recoveryPath, documentRecovery: state.documents[0].recoveryPath,
    selected: state.activeTabId, busy: nativePopoutBusy() })
    .toEqual({ source: doc.path, sheet: sheetArchive, recovery: path, documentRecovery: path, selected: "notes", busy: false });
}));
test("failed exit checkpoint restores selection without publishing recovery", async () => withListener(async () => {
  state.tabs.push({ id: "notes", location: { kind: "text-file", path: "/data/notes.txt" } });
  state.activeTabId = "notes";
  state.setActiveTab = (id: string) => { state.activeTabId = id; };
  const before = [...state.tabs];
  failSave = true;
  await expect(checkpointNativePopoutForExit()).rejects.toThrow("disk full");
  expect({ tabs: state.tabs, selected: state.activeTabId, busy: nativePopoutBusy() })
    .toEqual({ tabs: before, selected: "notes", busy: false });
}));
test("cancelled app exit cannot publish a late checkpoint or change the next selected tab", async () => withListener(async () => {
  state.documents = [{ ...doc, renderer: "xyzrender-external", recoveryPath: undefined }];
  state.tabs = [{ ...tab, location: { ...tab.location, recoveryPath: undefined } }, { id: "notes", location: { kind: "launcher" } }];
  state.activeTabId = "notes";
  state.setActiveTab = (id: string) => { state.activeTabId = id; };
  sheetArchive = { version: 1, items: [] };
  let finishWrite!: (path: string) => void;
  writeSheet = () => new Promise(resolve => { finishWrite = resolve; });
  const controller = new AbortController();
  const exiting = checkpointNativePopoutForExit(controller.signal);
  await flush();
  expect(nativePopoutBusy()).toBe(true);
  controller.abort();
  await expect(exiting).rejects.toThrow("cancelled");
  expect({ selected: state.activeTabId, busy: nativePopoutBusy(), recovery: state.tabs[0].location.recoveryPath })
    .toEqual({ selected: "notes", busy: false, recovery: undefined });
  state.activeTabId = "tab";
  finishWrite(path); await flush();
  expect({ selected: state.activeTabId, busy: nativePopoutBusy(), recovery: state.tabs[0].location.recoveryPath, count: state.tabs.length })
    .toEqual({ selected: "tab", busy: false, recovery: undefined, count: 2 });
}));
test("app exit preserves deferred scene checkpoints without waking their viewers", async () => withListener(async () => {
  state.documents = [{ ...doc, runtimeDeferred: true }];
  await checkpointNativePopoutForExit();
  expect(savedSources).toHaveLength(0);
  expect(state.tabs[0].location.recoveryPath).toBe(path);
  expect(nativePopoutBusy()).toBe(false);
}));
test("receiver rejects an already-open source without modifying its tabs", async () => withListener(async () => {
  let opened = false; openIncoming = async () => { opened = true; };
  await listener({ payload: { kind: "offer", id: "collision", from: "workspace-parent", path, sourcePath: doc.path, title: "Protein", index: 0, pinned: false } });
  expect({ opened, reply: latest.kind, ids: state.tabs.map((item: any) => item.id) }).toEqual({ opened: false, reply: "failed", ids: ["tab"] });
}));
test("drop outside a tab strip is rejected before opening a scene", async () => withListener(async () => {
  let opened = false; openIncoming = async () => { opened = true; };
  const original = document.elementFromPoint;
  document.elementFromPoint = () => document.body;
  try {
    await listener({ payload: { kind: "offer", id: "outside-strip", from: "workspace-parent", path,
      sourcePath: "/data/new.pdb", title: "Protein", index: 0, pinned: false, targetPosition: { x: 12, y: 100 } } });
    expect({ opened, kind: latest.kind, busy: nativePopoutBusy(), ids: state.tabs.map((item: any) => item.id) })
      .toEqual({ opened: false, kind: "failed", busy: false, ids: ["tab"] });
  } finally { document.elementFromPoint = original; }
}));
test("cancel during loading removes only the introduced tab and cannot acknowledge late readiness", async () => withListener(async () => {
  state.tabs = []; state.documents = [];
  openIncoming = async () => { state.tabs = [tab]; state.documents = [doc]; };
  let release!: () => void;
  readiness = () => new Promise(resolve => { release = () => resolve({ ready: true }); });
  const receiving = listener({ payload: { kind: "offer", id: "slow", from: "workspace-parent", path, sourcePath: doc.path, title: "Protein", index: 0, pinned: false } });
  await flush();
  expect(surface.inert).toBe(true);
  await listener({ payload: { kind: "cancel", id: "slow", from: "workspace-parent" } });
  release(); await receiving;
  expect(state.tabs).toEqual([]);
  expect(latest.kind).not.toBe("ready");
}));
test("receiver remains locked until commit and ignores cancellation after commitment", async () => withListener(async () => {
  state.tabs = []; state.documents = [];
  openIncoming = async () => { state.tabs = [tab]; state.documents = [doc]; };
  await listener({ payload: { kind: "offer", id: "commit-flow", from: "workspace-parent", path, sourcePath: doc.path, title: "Protein", index: 0, pinned: false } });
  expect({ inert: surface.inert, kind: latest.kind }).toEqual({ inert: true, kind: "ready" });
  await listener({ payload: { kind: "commit", id: "commit-flow", from: "workspace-parent" } });
  expect({ inert: surface.inert, kind: latest.kind }).toEqual({ inert: false, kind: "committed" });
  await listener({ payload: { kind: "cancel", id: "commit-flow", from: "workspace-parent" } });
  expect(state.tabs).toHaveLength(1);
}));
test("an abandoned prepared scene expires and a late commit cannot resurrect it", async () => withListener(async () => {
  state.tabs = []; state.documents = [];
  openIncoming = async () => { state.tabs = [tab]; state.documents = [doc]; };
  const originalSetTimeout = globalThis.setTimeout;
  let expire: (() => void) | undefined;
  globalThis.setTimeout = ((callback: (...args: any[]) => void, delay?: number, ...args: any[]) => {
    if (delay === 60000) expire = () => callback(...args);
    return originalSetTimeout(callback, delay, ...args);
  }) as typeof setTimeout;
  try {
    await listener({ payload: { kind: "offer", id: "abandoned", from: "workspace-gone", path, sourcePath: doc.path, title: "Protein", index: 0, pinned: false } });
    expect({ kind: latest.kind, busy: nativePopoutBusy(), inert: surface.inert }).toEqual({ kind: "ready", busy: true, inert: true });
    expect(expire).toBeFunction();
    expire!(); await flush();
    expect({ tabs: state.tabs.length, busy: nativePopoutBusy() }).toEqual({ tabs: 0, busy: false });
    await listener({ payload: { kind: "commit", id: "abandoned", from: "workspace-gone" } });
    expect(latest.kind).not.toBe("committed");
    expect(state.tabs).toEqual([]);
  } finally { globalThis.setTimeout = originalSetTimeout; }
}));
test("exit checkpoints restored recovery documents even without a live parent", async () => withListener(async () => {
  const second = { ...doc, id: "second", path: "/data/second.pdb" };
  state.documents = [doc, second];
  state.tabs = [tab, { ...tab, id: "tab-second", location: { ...tab.location, documentId: second.id, path: second.path } }];
  await checkpointNativePopoutForExit();
  expect(savedSources).toEqual([doc.path, second.path]);
  expect(state.documents.map((item: any) => item.path)).toEqual([doc.path, second.path]);
}));
test("two moved scenes retain independent parent ownership", async () => withListener(async () => {
  const secondPath = path.replace("01234567", "11234567");
  const second = { ...doc, id: "second", path: "/data/second.pdb", recoveryPath: secondPath };
  const secondTab = { ...tab, id: "tab-second", location: { ...tab.location, documentId: second.id, path: second.path } };
  state.documents = [doc, second]; state.tabs = [tab, secondTab];
  for (const [id, checkpoint] of [["first", path], ["second", secondPath]]) {
    await listener({ payload: { kind: "offer", id, from: `workspace-${id}`, path: checkpoint, title: id, index: 0, pinned: false } });
    await listener({ payload: { kind: "commit", id, from: `workspace-${id}` } });
  }
  expect([isNativePopoutTab("tab"), isNativePopoutTab("tab-second")]).toEqual([true, true]);
  const returning = returnNativePopout("tab"); await flush();
  expect(latest.target).toBe("workspace-first");
  await listener({ payload: { kind: "ready", id: latest.id, from: "workspace-first" } });
  await listener({ payload: { kind: "committed", id: latest.id, from: "workspace-first" } });
  expect(await returning).toBe(false);
  expect(state.tabs.map((item: any) => item.id)).toEqual(["tab-second"]);
  expect(isNativePopoutTab("tab-second")).toBe(true);
}));
test("a removed prepared tab cannot acknowledge commitment", async () => withListener(async () => {
  state.tabs = []; state.documents = [];
  openIncoming = async () => { state.tabs = [tab]; state.documents = [doc]; };
  await listener({ payload: { kind: "offer", id: "removed", from: "workspace-parent", path, sourcePath: doc.path, title: "Protein", index: 0, pinned: false } });
  state.tabs = [];
  await listener({ payload: { kind: "commit", id: "removed", from: "workspace-parent" } });
  expect(latest.kind).toBe("failed");
  expect(nativePopoutBusy()).toBe(false);
}));
test("outbound keeps the source frozen and open until the receiving scene acknowledges readiness", async () => withListener(async () => {
  const moving = popOutNativeScene("tab"); await flush();
  expect({ count: state.tabs.length, inert: surface.inert, busy: nativePopoutBusy(), kind: latest.kind }).toEqual({ count: 1, inert: true, busy: true, kind: "offer" });
  await listener({ payload: { kind: "ready", id: latest.id, from: "wrong-peer" } });
  expect(state.tabs).toHaveLength(1);
  await listener({ payload: { kind: "ready", id: latest.id, from: "workspace-peer" } });
  expect({ count: state.tabs.length, kind: latest.kind }).toEqual({ count: 1, kind: "commit" });
  await listener({ payload: { kind: "committed", id: latest.id, from: "workspace-peer" } }); await moving;
  expect({ count: state.tabs.length, inert: surface.inert, busy: nativePopoutBusy() }).toEqual({ count: 0, inert: false, busy: false });
}));
test("checkpoint failure retains the source and unlocks its controls", async () => withListener(async () => {
  failSave = true; await popOutNativeScene("tab");
  expect({ count: state.tabs.length, inert: surface.inert, busy: nativePopoutBusy() }).toEqual({ count: 1, inert: false, busy: false });
}));
test("rejected outbound handoff requests destination close without retiring the source", async () => withListener(async () => {
  const moving = popOutNativeScene("tab"); await flush();
  await listener({ payload: { kind: "failed", id: latest.id, from: "workspace-peer" } });
  await moving;
  expect({ tabs: state.tabs.map((item: any) => item.id), closedWindows, inert: surface.inert, busy: nativePopoutBusy() })
    .toEqual({ tabs: ["tab"], closedWindows: ["workspace-peer"], inert: false, busy: false });
}));
test("a rejected move to an existing window never closes that window", async () => withListener(async () => {
  const moving = popOutNativeScene("tab", "workspace-existing"); await flush();
  expect(latest.target).toBe("workspace-existing");
  await listener({ payload: { kind: "failed", id: latest.id, from: "workspace-existing" } });
  await moving;
  expect({ tabs: state.tabs.map((item: any) => item.id), closedWindows }).toEqual({ tabs: ["tab"], closedWindows: [] });
}));
test("return holds source edits until parent acknowledgment and safely unlocks on failure", async () => withListener(async () => {
  await listener({ payload: { kind: "offer", id: "incoming", from: "workspace-parent", path, title: "Protein", index: 0, pinned: false } });
  await listener({ payload: { kind: "commit", id: "incoming", from: "workspace-parent" } });
  const returning = returnNativePopout(); await flush();
  expect({ count: state.tabs.length, inert: surface.inert, busy: nativePopoutBusy(), kind: latest.kind }).toEqual({ count: 1, inert: true, busy: true, kind: "return" });
  const failed = returning.then(() => "success", error => error.message);
  await listener({ payload: { kind: "failed", id: latest.id, from: "workspace-parent" } }); expect(await failed).toContain("still open");
  expect({ count: state.tabs.length, inert: surface.inert, busy: nativePopoutBusy() }).toEqual({ count: 1, inert: false, busy: false });
  const retry = returnNativePopout(); await flush(); await listener({ payload: { kind: "ready", id: latest.id, from: "workspace-parent" } });
  await listener({ payload: { kind: "committed", id: latest.id, from: "workspace-parent" } });
  expect(await retry).toBe(true); expect(state.tabs).toHaveLength(0);
}));

test("closing a stale owner never leaves the window busy", async () => withListener(async () => {
  await listener({ payload: { kind: "offer", id: "stale", from: "workspace-parent", path, title: "Protein", index: 0, pinned: false } });
  await listener({ payload: { kind: "commit", id: "stale", from: "workspace-parent" } });
  state.tabs = [];
  expect(await returnNativePopout()).toBe(false);
  expect(nativePopoutBusy()).toBe(false);
}));
