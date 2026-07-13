#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  dispatchViewerBridgeMessage,
  parseViewerBridgeMessage,
  viewerBridgeBodyDocumentId,
  viewerBridgeSource,
} from "../apps/desktop/src/lib/viewer-bridge-messages.ts";

function makeHandlers(overrides = {}) {
  const calls = [];
  const handler = (name, result = false) => (...args) => {
    calls.push([name, ...args]);
    return result;
  };
  const handlers = {
    handleDockingPoseMessage: handler("dock"),
    handleGridConformerMessage: handler("grid-conformer"),
    handleGridControlMessage: handler("grid-control"),
    handleGridFileMessage: handler("grid-file"),
    handleGridRuntimeMessage: handler("grid-runtime"),
    handleKetcherViewerMessage: handler("ketcher"),
    handleMolstarContextMessage: handler("molstar-context"),
    handlePubChemSearchMessage: handler("pubchem"),
    handleRendererMessage: handler("renderer"),
    handleSdfViewerMessage: async (...args) => {
      calls.push(["sdf", ...args]);
      return false;
    },
    handleViewerConformerMessage: handler("viewer-conformer"),
    handleViewerFileMessage: handler("viewer-file"),
    handleViewerHostMessage: handler("host"),
    handleViewerRuntimeFileMessage: handler("runtime-file"),
    handleViewerRuntimeMessage: handler("runtime"),
    handleViewerStateMessage: handler("state"),
    handleXyzrenderSheetMessage: handler("xyzrender-sheet"),
    isKnownViewerMessageSource: (eventSource, documentId) => {
      calls.push(["known", eventSource, documentId]);
      return true;
    },
    markViewerFirstRenderMessage: (...args) => {
      calls.push(["first-render", ...args]);
    },
    ...overrides,
  };
  return { calls, handlers };
}

assert.equal(viewerBridgeSource("burrete-viewer"), "burrete-viewer");
assert.equal(viewerBridgeSource("burrete-grid"), "burrete-grid");
assert.equal(viewerBridgeSource("burrete-agent-viewer"), "burrete-agent-viewer");
assert.equal(viewerBridgeSource("burrete-host"), null);
assert.equal(viewerBridgeSource(undefined), null);

const eventSource = { postMessage() {} };
const body = { type: "viewer-ready", documentId: "doc-1" };
const message = parseViewerBridgeMessage({
  data: { source: "burrete-viewer", body },
  source: eventSource,
});
assert.deepEqual(message, {
  source: "burrete-viewer",
  body,
  eventSource,
});
assert.equal(parseViewerBridgeMessage({ data: "not-an-envelope", source: eventSource }), null);
assert.equal(parseViewerBridgeMessage({ data: { source: "unknown", body }, source: eventSource }), null);
assert.equal(viewerBridgeBodyDocumentId(body), "doc-1");
assert.equal(viewerBridgeBodyDocumentId({ documentId: 1 }), undefined);
assert.equal(viewerBridgeBodyDocumentId(null), undefined);

{
  const pubChemBody = { type: "openPubChemSearch", searchType: "identity", smiles: "C#N", documentId: "doc-1" };
  const pubChemMessage = parseViewerBridgeMessage({
    data: { source: "burrete-viewer", body: pubChemBody },
    source: eventSource,
  });
  assert.ok(pubChemMessage);
  const { calls, handlers } = makeHandlers({
    handlePubChemSearchMessage: (receivedBody) => {
      calls.push(["pubchem", receivedBody]);
      return true;
    },
  });
  assert.equal(await dispatchViewerBridgeMessage(pubChemMessage, handlers), true);
  assert.equal(calls.some(([name]) => name === "pubchem"), true);
}

{
  const { calls, handlers } = makeHandlers({
    isKnownViewerMessageSource: (source, documentId) => {
      calls.push(["known", source, documentId]);
      return false;
    },
  });
  const handled = await dispatchViewerBridgeMessage(message, handlers);
  assert.equal(handled, false);
  assert.deepEqual(calls, [["known", eventSource, "doc-1"]]);
}

{
  const { calls, handlers } = makeHandlers({
    handleViewerHostMessage: (source, receivedBody) => {
      calls.push(["host", source, receivedBody]);
      return true;
    },
  });
  const handled = await dispatchViewerBridgeMessage(message, handlers);
  assert.equal(handled, true);
  assert.deepEqual(calls, [
    ["known", eventSource, "doc-1"],
    ["host", "burrete-viewer", body],
  ]);
}

{
  const { calls, handlers } = makeHandlers({
    handleSdfViewerMessage: async (receivedBody) => {
      calls.push(["sdf", receivedBody]);
      return true;
    },
  });
  const handled = await dispatchViewerBridgeMessage(message, handlers);
  assert.equal(handled, true);
  assert.deepEqual(calls.map((call) => call[0]), [
    "known",
    "host",
    "state",
    "runtime-file",
    "dock",
    "first-render",
    "viewer-file",
    "xyzrender-sheet",
    "runtime",
    "sdf",
  ]);
}

{
  const gridBody = { type: "grid-save", documentId: "grid-doc" };
  const gridMessage = parseViewerBridgeMessage({
    data: { source: "burrete-grid", body: gridBody },
    source: eventSource,
  });
  assert.ok(gridMessage);
  const { calls, handlers } = makeHandlers({
    handleGridFileMessage: (receivedBody, source) => {
      calls.push(["grid-file", receivedBody, source]);
      return true;
    },
  });
  const handled = await dispatchViewerBridgeMessage(gridMessage, handlers);
  assert.equal(handled, true);
  assert.deepEqual(calls.map((call) => call[0]), [
    "known",
    "host",
    "state",
    "runtime-file",
    "dock",
    "first-render",
    "xyzrender-sheet",
    "grid-control",
    "grid-file",
  ]);
  assert.equal(calls.some((call) => call[0] === "viewer-file"), false);
}

console.log("viewer bridge message contract tests passed");
