#!/usr/bin/env bun
import assert from "node:assert/strict";
import {
  beginWindowCloseTransition,
  ExitTransitionActiveError,
  createExitMutationBarrier,
  isGridDocumentCloseTransitionActive,
  replayPendingGridCloseTransitionRequests,
  resumeWindowMutations,
  runWindowMutation,
  sameWindowItemIds,
  sealWindowMutations,
  setGridDocumentCloseTransition,
  setWindowShellCloseTransition,
  waitForGridDocumentCloseTransition,
} from "../apps/desktop/src/lib/window-mutation-barrier.ts";

const barrier = createExitMutationBarrier();
const release = barrier.begin("grid-main");
assert.deepEqual(barrier.seal(), {
  closeTransitionActive: false,
  pendingCount: 1,
  pendingDocumentIds: ["grid-main"],
});
assert.throws(() => barrier.begin("grid-late"), ExitTransitionActiveError);

release();
release();
assert.deepEqual(barrier.seal(), {
  closeTransitionActive: false,
  pendingCount: 0,
  pendingDocumentIds: [],
});

barrier.resume();
const releaseAfterResume = barrier.begin("grid-resumed");
assert.equal(barrier.seal().pendingCount, 1);
releaseAfterResume();
barrier.resume();

const releasePending = barrier.begin("grid-closing");
const closeTransition = barrier.beginCloseTransition();
assert.deepEqual({
  closeTransitionActive: closeTransition.closeTransitionActive,
  pendingCount: closeTransition.pendingCount,
  pendingDocumentIds: closeTransition.pendingDocumentIds,
}, {
  closeTransitionActive: true,
  pendingCount: 1,
  pendingDocumentIds: ["grid-closing"],
});
assert.throws(() => barrier.begin("grid-late-close"), ExitTransitionActiveError);

let pendingSettled = false;
const pending = closeTransition.waitForPending(["grid-closing"]).then(() => {
  pendingSettled = true;
});
await Promise.resolve();
assert.equal(pendingSettled, false);
releasePending();
await pending;
assert.equal(pendingSettled, true);

barrier.seal();
closeTransition.release();
closeTransition.release();
assert.throws(() => barrier.begin("grid-still-exiting"), ExitTransitionActiveError);
barrier.resume();
const releaseAfterClose = barrier.begin("grid-after-close");
releaseAfterClose();

await assert.rejects(
  runWindowMutation("grid-reject", async () => {
    throw new Error("mutation failed");
  }),
  /mutation failed/,
);
assert.equal(sealWindowMutations().pendingCount, 0);
resumeWindowMutations();

let finishSave;
const saveOperation = runWindowMutation("grid-save", () => new Promise((resolve) => {
  finishSave = resolve;
}));
const closeDuringSave = beginWindowCloseTransition();
let closeDuringSaveSettled = false;
const waitForSave = closeDuringSave.waitForPending(["grid-save"]).then(() => {
  closeDuringSaveSettled = true;
});
await Promise.resolve();
assert.equal(closeDuringSaveSettled, false);
finishSave();
await saveOperation;
await waitForSave;
assert.equal(closeDuringSaveSettled, true);
closeDuringSave.release();

let finishUnmaterializedWrite;
const unmaterializedWrite = runWindowMutation("/tmp/new-collection.sdf", () => new Promise((resolve) => {
  finishUnmaterializedWrite = resolve;
}));
const closeDuringUnmaterializedWrite = beginWindowCloseTransition();
let unmaterializedWriteSettled = false;
const waitForUnmaterializedWrite = closeDuringUnmaterializedWrite.waitForPending().then(() => {
  unmaterializedWriteSettled = true;
});
await Promise.resolve();
assert.equal(unmaterializedWriteSettled, false);
finishUnmaterializedWrite();
await unmaterializedWrite;
await waitForUnmaterializedWrite;
assert.equal(unmaterializedWriteSettled, true);
closeDuringUnmaterializedWrite.release();

const mutationOrder = [];
let finishFirstMutation;
const firstMutation = runWindowMutation("grid-serial", async () => {
  mutationOrder.push("first-start");
  await new Promise((resolve) => {
    finishFirstMutation = resolve;
  });
  mutationOrder.push("first-end");
});
await Promise.resolve();
const secondMutation = runWindowMutation("grid-serial", async () => {
  mutationOrder.push("second");
});
await Promise.resolve();
assert.deepEqual(mutationOrder, ["first-start"]);
finishFirstMutation();
await Promise.all([firstMutation, secondMutation]);
assert.deepEqual(mutationOrder, ["first-start", "first-end", "second"]);

assert.equal(sameWindowItemIds(["doc-a", "doc-b"], ["doc-a", "doc-b"]), true);
assert.equal(sameWindowItemIds(["doc-a", "doc-b"], ["doc-b", "doc-a"]), false);
assert.equal(sameWindowItemIds(["doc-a"], ["doc-a", "doc-b"]), false);

const shellAttributes = new Set();
const shell = {
  inert: false,
  toggleAttribute(name, active) {
    if (active) shellAttributes.add(name);
    else shellAttributes.delete(name);
  },
};
globalThis.document = { querySelector: () => shell };
setWindowShellCloseTransition(true);
assert.equal(shell.inert, true);
assert.equal(shellAttributes.has("aria-busy"), true);
setWindowShellCloseTransition(false);
assert.equal(shell.inert, false);
assert.equal(shellAttributes.has("aria-busy"), false);
delete globalThis.document;

const iframeAttributes = new Set();
const postedMessages = [];
const messageListeners = new Set();
const gridContentWindow = {
  postMessage(message) {
    postedMessages.push(message);
    const requestId = message?.body?.requestId;
    if (!requestId) return;
    queueMicrotask(() => {
      for (const listener of messageListeners) {
        listener({
          source: gridContentWindow,
          data: {
            source: "burrete-grid",
            body: { type: "gridCloseTransitionAcknowledged", requestId, active: true },
          },
        });
      }
    });
  },
};
const gridIframe = {
  dataset: { documentId: "grid-freeze", renderer: "grid2d" },
  inert: false,
  blurCalled: false,
  blur() {
    this.blurCalled = true;
  },
  toggleAttribute(name, active) {
    if (active) iframeAttributes.add(name);
    else iframeAttributes.delete(name);
  },
  contentWindow: gridContentWindow,
};
globalThis.document = { querySelectorAll: () => [gridIframe] };
globalThis.window = {
  addEventListener(_type, listener) {
    messageListeners.add(listener);
  },
  removeEventListener(_type, listener) {
    messageListeners.delete(listener);
  },
  clearTimeout,
  setTimeout,
};
setGridDocumentCloseTransition(["other-grid"], true);
assert.equal(gridIframe.inert, false);
setGridDocumentCloseTransition(["other-grid"], false);
setGridDocumentCloseTransition(["grid-freeze"], true);
assert.equal(gridIframe.blurCalled, true);
assert.equal(gridIframe.inert, true);
assert.equal(iframeAttributes.has("aria-busy"), true);
assert.deepEqual(postedMessages.at(-1)?.body, { type: "gridCloseTransitionChanged", active: true });
assert.equal(isGridDocumentCloseTransitionActive("grid-freeze"), true);
await waitForGridDocumentCloseTransition(["grid-freeze"]);
assert.equal(postedMessages.at(-1)?.body?.type, "gridCloseTransitionChanged");
assert.ok(postedMessages.at(-1)?.body?.requestId);
setGridDocumentCloseTransition(["grid-freeze"], true);
setGridDocumentCloseTransition(["grid-freeze"], false);
assert.equal(gridIframe.inert, true);
assert.equal(iframeAttributes.has("aria-busy"), true);
assert.deepEqual(postedMessages.at(-1)?.body, { type: "gridCloseTransitionChanged", active: true });
assert.equal(isGridDocumentCloseTransitionActive("grid-freeze"), true);
setGridDocumentCloseTransition(["grid-freeze"], false);
assert.equal(gridIframe.inert, false);
assert.equal(iframeAttributes.has("aria-busy"), false);
assert.deepEqual(postedMessages.at(-1)?.body, { type: "gridCloseTransitionChanged", active: false });
assert.equal(isGridDocumentCloseTransitionActive("grid-freeze"), false);

const latePostedMessages = [];
let lateGridListenerReady = false;
const lateGridContentWindow = {
  postMessage(message) {
    latePostedMessages.push(message);
    const requestId = message?.body?.requestId;
    if (!requestId || !lateGridListenerReady) return;
    queueMicrotask(() => {
      for (const listener of messageListeners) {
        listener({
          source: lateGridContentWindow,
          data: {
            source: "burrete-grid",
            body: { type: "gridCloseTransitionAcknowledged", requestId, active: true },
          },
        });
      }
    });
  },
};
const lateGridIframe = {
  dataset: { documentId: "grid-late-listener", renderer: "grid2d" },
  inert: false,
  blur() {},
  toggleAttribute() {},
  contentWindow: lateGridContentWindow,
};
globalThis.document = { querySelectorAll: () => [lateGridIframe] };
setGridDocumentCloseTransition(["grid-late-listener"], true);
const lateAcknowledgement = waitForGridDocumentCloseTransition(["grid-late-listener"]);
replayPendingGridCloseTransitionRequests(lateGridIframe);
await new Promise((resolve) => setTimeout(resolve, 10));
lateGridListenerReady = true;
await lateAcknowledgement;
const lateRequestIds = latePostedMessages
  .map((message) => message?.body?.requestId)
  .filter(Boolean);
assert.ok(lateRequestIds.length >= 3);
assert.equal(new Set(lateRequestIds).size, 1);
setGridDocumentCloseTransition(["grid-late-listener"], false);
delete globalThis.document;
delete globalThis.window;

console.log("window mutation barrier tests passed");
