#!/usr/bin/env bun
import assert from "node:assert/strict";
import { decideWindowClose } from "../apps/desktop/src/lib/window-close.ts";

function prompts(overrides = {}) {
  const calls = [];
  return {
    calls,
    input: {
      pendingCount: 0,
      closeTransitionActive: false,
      dirty: false,
      gridDirty: false,
      sourceDirty: false,
      confirm: async () => {
        calls.push("confirm");
        return overrides.confirm ?? true;
      },
      sourceConfirm: async () => {
        calls.push("sourceConfirm");
        return overrides.sourceConfirm ?? true;
      },
      notifySaveInProgress: async () => {
        calls.push("notify");
      },
      ...overrides.input,
    },
  };
}

// A clean window closes without any prompt.
{
  const { calls, input } = prompts();
  assert.equal(await decideWindowClose(input), "close");
  assert.deepEqual(calls, []);
}

// A running window mutation always aborts, before any confirm is shown.
{
  const { calls, input } = prompts({ input: { pendingCount: 1, dirty: true, gridDirty: true } });
  assert.equal(await decideWindowClose(input), "abort");
  assert.deepEqual(calls, ["notify"]);
}

// A source save in flight aborts the same way.
{
  const { calls, input } = prompts({ input: { closeTransitionActive: true, dirty: true, sourceDirty: true } });
  assert.equal(await decideWindowClose(input), "abort");
  assert.deepEqual(calls, ["notify"]);
}

// Dirty grid documents get the generic discard prompt.
{
  const accepted = prompts({ input: { dirty: true, gridDirty: true } });
  assert.equal(await decideWindowClose(accepted.input), "close");
  assert.deepEqual(accepted.calls, ["confirm"]);

  const cancelled = prompts({ confirm: false, input: { dirty: true, gridDirty: true } });
  assert.equal(await decideWindowClose(cancelled.input), "abort");
  assert.deepEqual(cancelled.calls, ["confirm"]);
}

// Dirty sources use the source-editing prompt only, never a second generic one.
{
  const accepted = prompts({ input: { dirty: true, sourceDirty: true } });
  assert.equal(await decideWindowClose(accepted.input), "close");
  assert.deepEqual(accepted.calls, ["sourceConfirm"]);

  const cancelled = prompts({ sourceConfirm: false, input: { dirty: true, sourceDirty: true } });
  assert.equal(await decideWindowClose(cancelled.input), "abort");
  assert.deepEqual(cancelled.calls, ["sourceConfirm"]);
}

// Both dirty: the source prompt first, then the generic one for the grid edits;
// cancelling the source prompt stops before the generic one is shown.
{
  const accepted = prompts({ input: { dirty: true, gridDirty: true, sourceDirty: true } });
  assert.equal(await decideWindowClose(accepted.input), "close");
  assert.deepEqual(accepted.calls, ["sourceConfirm", "confirm"]);

  const cancelled = prompts({ sourceConfirm: false, input: { dirty: true, gridDirty: true, sourceDirty: true } });
  assert.equal(await decideWindowClose(cancelled.input), "abort");
  assert.deepEqual(cancelled.calls, ["sourceConfirm"]);
}

// A dirty flag with neither split flag set still falls back to the generic prompt.
{
  const { calls, input } = prompts({ confirm: false, input: { dirty: true } });
  assert.equal(await decideWindowClose(input), "abort");
  assert.deepEqual(calls, ["confirm"]);
}

console.log("window close behavior tests passed");

// Exercise the actual hook and its Tauri boundary, including failures after
// sealing edits. The native commands/dialogs are the only mocked boundary.
const { mock } = await import("bun:test");
const { Window } = await import("happy-dom");
const React = await import("react");
const dom = new Window({ url: "http://localhost/?buretteWindow=workspace-2" });
Object.assign(globalThis, {
  window: dom, document: dom.document, HTMLElement: dom.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
});
dom.__TAURI_INTERNALS__ = {};
let onClose;
let confirmResult;
let closeResult;
let windowCount = 2;
const commands = [];
const events = new Map();
mock.module("@tauri-apps/api/core", () => ({
  convertFileSrc: (path) => path,
  invoke: async (command) => {
    commands.push(command);
    if (command === "close_workspace_window") return closeResult();
    if (command === "drain_native_menu_commands") return [];
    return null;
  },
}));
mock.module("@tauri-apps/api/window", () => ({
  getAllWindows: async () => Array.from({ length: windowCount }, () => ({})),
  getCurrentWindow: () => ({
    onCloseRequested: async (callback) => { onClose = callback; return () => {}; },
    onFocusChanged: async () => () => {},
  }),
}));
mock.module("@tauri-apps/api/event", () => ({
  listen: async (name, callback) => { events.set(name, callback); return () => events.delete(name); },
}));
mock.module("@tauri-apps/plugin-dialog", () => ({
  confirm: async () => confirmResult(), message: async () => {},
}));
const { createRoot } = await import("react-dom/client");
const { useAppNativeMenu } = await import("../apps/desktop/src/hooks/use-app-native-menu.ts");
const { runWindowMutation, resumeWindowMutations } = await import("../apps/desktop/src/lib/window-mutation-barrier.ts");
const { EXIT_TRANSITION_RESUMED_EVENT } = await import("../apps/desktop/src/lib/native-menu.ts");
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
const state = { tabs: [], documents: [], textDocuments: [], recentStructures: [] };
function Harness() {
  useAppNativeMenu({ state, actions: {}, openDocuments: async () => {},
    getWindowDocumentDirtySnapshot: () => ({ dirty: true, gridDirty: true, sourceDirty: false, revision: 1, closeTransitionActive: false }),
    confirmSourceCloseWindow: async () => true, windowDocumentDirty: true,
    sourceSaveEnabled: false, saveActiveSource: async () => {},
  });
  return null;
}
const warnings = [];
const previousWarn = console.warn;
console.warn = (...args) => warnings.push(args);
try {
  for (const scenario of ["cancel", "dialog-error", "destroy-error", "became-last", "last-window"]) {
    resumeWindowMutations();
    windowCount = scenario === "last-window" ? 1 : 2;
    confirmResult = async () => {
      if (scenario === "dialog-error") throw new Error("dialog unavailable");
      return scenario !== "cancel";
    };
    closeResult = async () => {
      if (scenario === "destroy-error") throw new Error("destroy failed");
      return false;
    };
    dom.localStorage.setItem("burette.tab-workspaces.workspace-2", "saved-workspace");
    await React.act(async () => root.render(React.createElement(Harness, { key: scenario })));
    commands.length = 0;
    let prevented = false;
    await React.act(async () => { onClose({ preventDefault() { prevented = true; } }); });
    assert.equal(prevented, true);
    assert.equal(dom.localStorage.getItem("burette.tab-workspaces.workspace-2"), "saved-workspace", scenario);
    if (scenario === "became-last") events.get(EXIT_TRANSITION_RESUMED_EVENT)();
    assert.equal(await runWindowMutation("test", async () => "editable"), "editable", scenario);
    assert.equal(commands.includes("close_workspace_window"), ["destroy-error", "became-last"].includes(scenario), scenario);
    assert.equal(commands.includes("request_app_quit"), scenario === "last-window", scenario);
  }
  assert.equal(warnings.length, 2, "only injected failures log warnings");
} finally {
  console.warn = previousWarn;
  await React.act(async () => root.unmount());
  resumeWindowMutations();
  await dom.happyDOM.abort();
}
console.log("native window-close hook integration: 5 scenarios pass");
