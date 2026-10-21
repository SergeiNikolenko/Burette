import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "CSS", "MutationObserver"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
let listener: (event: { payload: any }) => Promise<void>;
const sent: any[] = [], opened: any[] = [], paths: string[][] = [];
const source = { id: "source", location: { kind: "chemical-space", collectionPath: "/collection.sdf" }, back: [], forward: [] };
const state = { textDocuments: [] as any[], activeTabId: "source", tabs: [source], openScreenTab(location: any) {
  opened.push(location); state.activeTabId = "received";
  // Native window creation may commit the screen after the offer handler runs,
  // without delivering animation frames while the window is in the background.
  setTimeout(() => { const surface = document.createElement("div"); surface.className = "page-surface"; surface.dataset.viewId = "received"; surface.dataset.workspaceVisible = "true"; document.body.append(surface); }, 20);
}, renameTab() {} };
mock.module("../apps/desktop/src/stores/tab-workspace-store", () => ({ defaultTabWorkspace: () => ({}), getTabWorkspace: () => ({ droppedStructures: [] }), useTabWorkspaceStore: { getState: () => ({}) } }));
mock.module("../apps/desktop/src/stores/molecule-store", () => ({ useMoleculeStore: { getState: () => state } }));
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => true, trackTauriListener: () => () => {} }));
mock.module("../apps/desktop/src/components/ui/toast", () => ({ toast: { add() {} } }));
mock.module("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main", listen: async (_: string, receive: typeof listener) => { listener = receive; return () => {}; } }) }));
mock.module("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => path, invoke: async (command: string, args: any) => {
  if (command === "open_new_workspace_window") return "workspace-child";
  if (command === "relay_workspace_page") sent.push(args);
} }));
const { openNativePageWindow, useNativePageWindowSession } = await import("../apps/desktop/src/components/workspace-panes/native-page-window");
function Session() { useNativePageWindowSession({ openPaths: async (input: string[]) => { paths.push(input); }, openTextPaths: async () => {} } as any); return null; }
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

test("new windows retain the source and accept only their own acknowledgement", async () => {
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Session />));
  let finished = false;
  const opening = openNativePageWindow(source as any).then(() => { finished = true; });
  await flush(); const request = sent.at(-1);
  expect(request.target).toBe("workspace-child");
  await listener({ payload: { kind: "ready", id: request.message.id, from: "wrong-window" } });
  expect(finished).toBe(false);
  await listener({ payload: { kind: "ready", id: request.message.id, from: "workspace-child" } });
  await opening;
  expect(state.tabs).toEqual([source]);
  const offer = { kind: "open", id: "request", from: "workspace-peer", location: request.message.location };
  await listener({ payload: offer }); await listener({ payload: offer });
  expect(paths).toEqual([["/collection.sdf"]]);
  expect(opened).toEqual([source.location]);
  expect(sent.at(-1).message.kind).toBe("ready");
  await listener({ payload: { kind: "open", id: "missing-text", from: "workspace-peer", location: { kind: "text-file", path: "/missing.txt" } } });
  expect(sent.at(-1).message.kind).toBe("failed");
  expect(opened.length).toBe(1);
  await act(async () => root.unmount());
});
