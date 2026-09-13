#!/usr/bin/env bun
import assert from "node:assert/strict";

import { createDragCommit } from "../apps/desktop/src/lib/drag-commit.ts";

function tracked() {
  const commits = [];
  const controller = createDragCommit((value) => commits.push(value));
  return { commits, controller };
}

{
  // Outside a drag every report commits immediately (keyboard resizes).
  const { commits, controller } = tracked();
  controller.report(300);
  controller.report(310);
  assert.deepEqual(commits, [300, 310]);
  assert.equal(controller.isDragging(), false);
}

{
  // Inside a drag the per-frame reports are parked and only the last one is
  // committed, once, when the drag ends.
  const { commits, controller } = tracked();
  controller.begin();
  assert.equal(controller.isDragging(), true);
  for (const px of [301, 302, 303, 340, 355]) controller.report(px);
  assert.deepEqual(commits, [], "no commit may happen while the pointer is down");
  controller.end();
  assert.deepEqual(commits, [355]);
  assert.equal(controller.isDragging(), false);
}

{
  // A press without movement commits nothing, and a second end is a no-op.
  const { commits, controller } = tracked();
  controller.begin();
  controller.end();
  controller.end();
  assert.deepEqual(commits, []);
}

{
  // Once the drag has ended, the pending value is cleared: a later drag that
  // reports nothing must not replay it.
  const { commits, controller } = tracked();
  controller.begin();
  controller.report(400);
  controller.end();
  controller.begin();
  controller.end();
  assert.deepEqual(commits, [400]);
}

{
  // Reports after the drag ended fall back to immediate commits.
  const { commits, controller } = tracked();
  controller.begin();
  controller.report(420);
  controller.end();
  controller.report(430);
  assert.deepEqual(commits, [420, 430]);
}

console.log("drag-commit behavior OK");
