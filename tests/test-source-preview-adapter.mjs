#!/usr/bin/env node
import assert from "node:assert/strict";

import { SourcePreviewAdapter } from "../apps/desktop/src/lib/source-preview/adapter.ts";

const activeRuntime = { runtimeKey: "disk-1", runtimePath: "active html" };
const identity = (revision, requestId = `request-${revision}`) => ({
  documentId: "doc-1",
  sessionId: "session-1",
  requestId,
  revision,
});
const candidate = (revision, requestId) => ({
  runtimeKey: `draft-${revision}`,
  runtimePath: `draft ${revision} html`,
  identity: identity(revision, requestId),
});

{
  const snapshots = [];
  const adapter = new SourcePreviewAdapter({
    activeRuntime,
    onChange: (snapshot) => snapshots.push(snapshot),
  });
  adapter.stage(candidate(1));
  assert.equal(adapter.getSnapshot().activeSlot, "primary");
  assert.equal(adapter.getSnapshot().slots.primary.runtimeKey, "disk-1");
  assert.equal(adapter.getSnapshot().slots.secondary.runtimeKey, "draft-1");

  let transferred;
  const result = await adapter.ready(identity(1), async (context) => {
    transferred = context;
  });
  assert.deepEqual(result, { status: "promoted", revision: 1 });
  assert.equal(transferred.active.runtimeKey, "disk-1");
  assert.equal(transferred.staging.runtimeKey, "draft-1");
  assert.equal(adapter.getSnapshot().activeSlot, "secondary");
  assert.equal(adapter.getSnapshot().slots.primary, null);
  assert.equal(adapter.getSnapshot().slots.secondary.runtimeKey, "draft-1");
  assert.equal(snapshots.length, 2);
  adapter.dispose();
}

{
  const failures = [];
  const adapter = new SourcePreviewAdapter({
    activeRuntime,
    onChange: () => {},
    onStageFailure: (failedIdentity, reason) => failures.push([failedIdentity.revision, reason]),
  });
  adapter.stage(candidate(1));
  adapter.stage(candidate(2));
  assert.deepEqual(failures, [[1, "superseded"]]);
  assert.deepEqual(await adapter.ready(identity(1)), { status: "stale" });
  assert.equal(adapter.getSnapshot().slots.primary.runtimeKey, "disk-1");
  assert.equal(adapter.getSnapshot().slots.secondary.runtimeKey, "draft-2");
  assert.equal(adapter.reject(identity(1)), false);
  assert.equal(adapter.reject(identity(2)), true);
  assert.deepEqual(failures, [[1, "superseded"], [2, "rejected"]]);
  assert.equal(adapter.getSnapshot().slots.secondary, null);
  adapter.dispose();
}

{
  const failures = [];
  const snapshots = [];
  const adapter = new SourcePreviewAdapter({
    activeRuntime,
    onChange: (snapshot) => snapshots.push(snapshot),
    onStageFailure: (failedIdentity, reason) => failures.push([failedIdentity.revision, reason]),
    stageTimeoutMs: 5,
  });
  adapter.stage(candidate(3));
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.deepEqual(failures, [[3, "timed-out"]]);
  assert.equal(adapter.getSnapshot().slots.secondary, null);
  assert.equal(snapshots.length, 2);
  adapter.dispose();
}

{
  const adapter = new SourcePreviewAdapter({
    activeRuntime,
    onChange: () => {},
    transferBudgetMs: 5,
  });
  adapter.stage(candidate(4));
  const startedAt = Date.now();
  const result = await adapter.ready(identity(4), () => new Promise(() => {}));
  assert.deepEqual(result, { status: "promoted", revision: 4 });
  assert.ok(Date.now() - startedAt < 100, "view-state timeout remains best effort");
  assert.equal(adapter.getSnapshot().slots.secondary.runtimeKey, "draft-4");
  adapter.dispose();
}

{
  const adapter = new SourcePreviewAdapter({
    activeRuntime,
    onChange: () => {},
    transferBudgetMs: 50,
  });
  adapter.stage(candidate(5));
  let releaseTransfer;
  const promotion = adapter.ready(identity(5), () => new Promise((resolve) => {
    releaseTransfer = resolve;
  }));
  adapter.stage(candidate(6));
  releaseTransfer();
  assert.deepEqual(await promotion, { status: "stale" });
  assert.equal(adapter.getSnapshot().slots.primary.runtimeKey, "disk-1");
  assert.equal(adapter.getSnapshot().slots.secondary.runtimeKey, "draft-6");
  adapter.dispose();
}

console.log("source preview adapter tests passed");
