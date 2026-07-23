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
  sealWindowMutations,
  setGridDocumentCloseTransition,
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

// Close transitions overlap instead of refusing each other: a tab's unsaved
// prompt must never make the window close button a no-op. The barrier only
// reports itself idle once every permit has been released.
const overlappingCloseTransition = barrier.beginCloseTransition();
assert.equal(overlappingCloseTransition.closeTransitionActive, true);
overlappingCloseTransition.release();
overlappingCloseTransition.release();
assert.equal(barrier.seal().closeTransitionActive, true);
barrier.resume();

releasePending();
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

// An unfinished save must not hold a close back — the permit is handed out
// while the mutation is still in flight and reports what is pending so the
// prompt can mention it.
let finishSave;
const saveOperation = runWindowMutation("grid-save", () => new Promise((resolve) => {
  finishSave = resolve;
}));
await new Promise((resolve) => setTimeout(resolve, 0));
const closeDuringSave = beginWindowCloseTransition();
assert.deepEqual(closeDuringSave.pendingDocumentIds, ["grid-save"]);
closeDuringSave.release();
finishSave();
await saveOperation;

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
