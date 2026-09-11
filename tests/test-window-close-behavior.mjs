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
