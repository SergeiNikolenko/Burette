#!/usr/bin/env bun
import assert from "node:assert/strict";
import { decideWindowClose } from "../apps/desktop/src/lib/window-close.ts";
import { clearWindowScopedStorage, workspaceStorageKey } from "../apps/desktop/src/lib/window-scope.ts";

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

// Window-scoped storage cleanup removes only the keys of the current window.
function fakeStorage(entries) {
  const map = new Map(entries);
  return {
    map,
    get length() {
      return map.size;
    },
    key(index) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

// Without a window (or in the main window) nothing is touched.
{
  const storage = fakeStorage([["burette.tab-workspaces.workspace-2", "{}"]]);
  assert.deepEqual(clearWindowScopedStorage(storage), []);
  assert.equal(storage.map.size, 1);
}

globalThis.window = { location: { search: "?buretteWindow=workspace-2" } };
assert.equal(workspaceStorageKey("burette.tab-workspaces"), "burette.tab-workspaces.workspace-2");
{
  const storage = fakeStorage([
    ["burette.tab-workspaces", "{}"],
    ["burette.tab-workspaces.workspace-2", "{}"],
    ["burette.molecule.session.workspace-2", "{}"],
    ["burette.molecule.session.workspace-12", "{}"],
    ["burette.shell.ui", "{}"],
  ]);
  assert.deepEqual(clearWindowScopedStorage(storage).sort(), [
    "burette.molecule.session.workspace-2",
    "burette.tab-workspaces.workspace-2",
  ]);
  assert.deepEqual([...storage.map.keys()], [
    "burette.tab-workspaces",
    "burette.molecule.session.workspace-12",
    "burette.shell.ui",
  ]);
}

globalThis.window = { location: { search: "?buretteWindow=main" } };
{
  const storage = fakeStorage([["burette.tab-workspaces", "{}"]]);
  assert.deepEqual(clearWindowScopedStorage(storage), []);
  assert.equal(storage.map.size, 1);
}

console.log("window close behavior tests passed");
