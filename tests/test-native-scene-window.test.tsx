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
const path = "/private/popout-scenes/01234567-1234-1234-1234-123456789012.molx";
const frame = document.createElement("iframe");
const surface = document.createElement("div"); surface.className = "page-surface"; surface.append(frame); document.body.append(surface);
const doc = { id: "scene", path, title: "Protein", renderer: "molstar" };
const tab = { id: "tab", title: "Protein", location: { kind: "file", documentId: "scene", path } };
let state: any;
function reset() { state = { tabs: [tab], documents: [doc], setActiveDocument() {}, renameTab() {}, togglePinnedTab() {}, moveTab() {}, closeTab(id: string) { state.tabs = state.tabs.filter((item: any) => item.id !== id); } }; latest = {}; failSave = false; }
const store = Object.assign(() => {}, { getState: () => state, setState: (fn: any) => { Object.assign(state, fn(state)); } });
mock.module("../apps/desktop/src/stores/molecule-store", () => ({ useMoleculeStore: store }));
mock.module("../apps/desktop/src/lib/viewer-bridge", () => ({ activeViewerIframeForDocument: () => frame, requestViewerAction: async (_: string, action: any) => action.type === "observe_story" ? { count: 1 } : action.type === "workspace_scene_state" ? { ready: true } : { dataBase64: "UEsDBA==" } }));
mock.module("../apps/desktop/src/hooks/workspace-scene-import", () => ({ focusSceneDocument: async () => {} }));
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => true, trackTauriListener: () => () => {} }));
mock.module("../apps/desktop/src/components/ui/toast", () => ({ toast: { add: () => {} } }));
mock.module("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "workspace-child", listen: async (_: string, receive: typeof listener) => { listener = receive; return () => {}; } }), Window: { getByLabel: async () => ({}) } }));
mock.module("@tauri-apps/api/core", () => ({ invoke: async (command: string, args: any) => {
  if (command === "save_popout_scene") { if (failSave) throw new Error("disk full"); return path; }
  if (command === "open_new_workspace_window") return "workspace-peer";
  if (command === "relay_popout_handoff") latest = { ...args.message, target: args.target };
} }));
// These cases exercise window handoff/rollback. Separate real scientific-consumer tests
// validate capture/restore bytes and acknowledgement before this boundary succeeds.
mock.module("../apps/desktop/src/lib/science-session/restore", () => ({ waitForSceneScienceRestore: async () => () => {}, sameSceneSource: () => true }));
mock.module("../apps/desktop/src/hooks/workspace-scene-snapshot", () => ({ captureWorkspaceSceneSnapshot: async (document: any) => ({
  document, result: { kind: "molx", dataBase64: "UEsDBA==" }, confirm: async () => {}, omissionReason: null,
}) }));
const { useNativePopoutSession, popOutNativeScene, returnNativePopout, nativePopoutBusy } = await import("../apps/desktop/src/components/workspace-panes/native-scene-window");
function Listener() { useNativePopoutSession({ openStructurePaths: async () => {} } as any); return null; }
async function withListener(run: () => Promise<void>) {
  reset(); const mount = document.createElement("div"); document.body.append(mount); const root = createRoot(mount);
  try { await act(async () => root.render(<Listener />)); await run(); }
  finally { await act(async () => root.unmount()); mount.remove(); }
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
test("outbound keeps the source frozen and open until the receiving scene acknowledges readiness", async () => withListener(async () => {
  const moving = popOutNativeScene("tab"); await flush();
  expect({ count: state.tabs.length, inert: surface.inert, busy: nativePopoutBusy(), kind: latest.kind }).toEqual({ count: 1, inert: true, busy: true, kind: "offer" });
  await listener({ payload: { kind: "ready", id: latest.id, from: "wrong-peer" } });
  expect(state.tabs).toHaveLength(1);
  await listener({ payload: { kind: "ready", id: latest.id, from: "workspace-peer" } }); await moving;
  expect({ count: state.tabs.length, inert: surface.inert, busy: nativePopoutBusy() }).toEqual({ count: 0, inert: false, busy: false });
}));
test("checkpoint failure retains the source and unlocks its controls", async () => withListener(async () => {
  failSave = true; await popOutNativeScene("tab");
  expect({ count: state.tabs.length, inert: surface.inert, busy: nativePopoutBusy() }).toEqual({ count: 1, inert: false, busy: false });
}));
test("return holds source edits until parent acknowledgment and safely unlocks on failure", async () => withListener(async () => {
  await listener({ payload: { kind: "offer", id: "incoming", from: "workspace-parent", path, title: "Protein", index: 0, pinned: false } });
  const returning = returnNativePopout(); await flush();
  expect({ count: state.tabs.length, inert: surface.inert, busy: nativePopoutBusy(), kind: latest.kind }).toEqual({ count: 1, inert: true, busy: true, kind: "return" });
  const failed = returning.then(() => "success", error => error.message);
  await listener({ payload: { kind: "failed", id: latest.id, from: "workspace-parent" } }); expect(await failed).toContain("still open");
  expect({ count: state.tabs.length, inert: surface.inert, busy: nativePopoutBusy() }).toEqual({ count: 1, inert: false, busy: false });
  const retry = returnNativePopout(); await flush(); await listener({ payload: { kind: "ready", id: latest.id, from: "workspace-parent" } });
  expect(await retry).toBe(true); expect(state.tabs).toHaveLength(0);
}));

test("closing a stale owner never leaves the window busy", async () => withListener(async () => {
  await listener({ payload: { kind: "offer", id: "stale", from: "workspace-parent", path, title: "Protein", index: 0, pinned: false } });
  state.tabs = [];
  expect(await returnNativePopout()).toBe(false);
  expect(nativePopoutBusy()).toBe(false);
}));
