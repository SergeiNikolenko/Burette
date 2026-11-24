#!/usr/bin/env node
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import {
  dispatchViewerBridgeMessage,
  parseViewerBridgeMessage,
  viewerBridgeBodyDocumentId,
  viewerBridgeSource,
} from "../apps/desktop/src/lib/viewer-bridge-messages.ts";
import { isReadOnlyViewerMessageSource } from "../apps/desktop/src/lib/viewer-bridge.ts";

function makeHandlers(overrides = {}) {
  const calls = [];
  const handler = (name, result = false) => (...args) => {
    calls.push([name, ...args]);
    return result;
  };
  const handlers = {
    handleDockingPoseMessage: handler("dock"),
    handleGridConformerMessage: handler("grid-conformer"),
    handleGridComputeMessage: handler("grid-compute"),
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

assert.equal(viewerBridgeSource("burette-viewer"), "burette-viewer");
assert.equal(viewerBridgeSource("burette-grid"), "burette-grid");
assert.equal(viewerBridgeSource("burette-agent-viewer"), "burette-agent-viewer");
assert.equal(viewerBridgeSource("burette-host"), null);
assert.equal(viewerBridgeSource(undefined), null);

const eventSource = { postMessage() {} };
const body = { type: "viewer-ready", documentId: "doc-1" };
const message = parseViewerBridgeMessage({
  data: { source: "burette-viewer", body },
  source: eventSource,
});
assert.deepEqual(message, {
  source: "burette-viewer",
  body,
  eventSource,
});
assert.equal(parseViewerBridgeMessage({ data: "not-an-envelope", source: eventSource }), null);
assert.equal(parseViewerBridgeMessage({ data: { source: "unknown", body }, source: eventSource }), null);
assert.equal(viewerBridgeBodyDocumentId(body), "doc-1");
assert.equal(viewerBridgeBodyDocumentId({ documentId: 1 }), undefined);
assert.equal(viewerBridgeBodyDocumentId(null), undefined);

{
  const cameraBody = { type: "rendererViewStateChanged", documentId: "doc-1", viewState: { camera: {} } };
  const { calls, handlers } = makeHandlers({
    handleRendererMessage: (...args) => {
      calls.push(["renderer", ...args]);
      return true;
    },
  });
  assert.equal(await dispatchViewerBridgeMessage({ source: "burette-viewer", body: cameraBody, eventSource }, handlers), true);
  // Pane checkpoints require the authenticated iframe identity, not just its document ID.
  assert.deepEqual(calls.filter(([name]) => name === "renderer"), [["renderer", cameraBody, eventSource]]);
}

{
  const pubChemBody = { type: "openPubChemSearch", searchType: "identity", smiles: "C#N", documentId: "doc-1" };
  const pubChemMessage = parseViewerBridgeMessage({
    data: { source: "burette-viewer", body: pubChemBody },
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
    handleViewerHostMessage: (source, receivedBody, receivedSource) => {
      calls.push(["host", source, receivedBody, receivedSource]);
      return true;
    },
  });
  const handled = await dispatchViewerBridgeMessage(message, handlers);
  assert.equal(handled, true);
  assert.deepEqual(calls, [
    ["known", eventSource, "doc-1"],
    ["host", "burette-viewer", body, eventSource],
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
    data: { source: "burette-grid", body: gridBody },
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
    "grid-compute",
    "grid-control",
    "grid-file",
  ]);
  assert.equal(calls.some((call) => call[0] === "viewer-file"), false);
}

{
  const gridMenuState = {
    type: "gridMenuStateChanged",
    documentId: "grid-doc",
    selectedCount: 2,
    dirty: true,
    canUndo: true,
    canRedo: true,
    undoLabel: "Delete Molecule",
    redoLabel: "Replace Molecule",
    editingText: false,
  };
  const gridMessage = parseViewerBridgeMessage({
    data: { source: "burette-grid", body: gridMenuState },
    source: eventSource,
  });
  assert.ok(gridMessage);
  const { calls, handlers } = makeHandlers({
    handleGridControlMessage: (receivedBody, source) => {
      calls.push(["grid-control", receivedBody, source]);
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
    "grid-compute",
    "grid-control",
  ]);
  assert.deepEqual(calls.at(-1)?.[1], gridMenuState);
  assert.equal(calls.at(-1)?.[2], eventSource);
}

globalThis.document = {
  querySelectorAll: () => [
    { contentWindow: eventSource },
    { contentWindow: { postMessage() {} } },
  ],
};
assert.equal(isReadOnlyViewerMessageSource(eventSource), true);
assert.equal(isReadOnlyViewerMessageSource({ postMessage() {} }), false);
assert.equal(isReadOnlyViewerMessageSource(null), false);
delete globalThis.document;

// JavaScriptCore Proper Tail Call on strict expression-bodied arrows or
// tail returns collapses the caller frame on WebKitGTK and delivers
// MessageEvent.source === target instead of window.parent.
{
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const scanRoots = [
    join(root, "apps/desktop/src"),
    join(root, "apps/desktop/public/interaction-diagram"),
  ];
  const tailPostMessage = /(=>|\breturn\b)\s*[^{;]*?\.postMessage\s*\(/g;
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "vendor" || entry.name === "dist") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(?:ts|tsx|js|mjs)$/.test(entry.name) || /\.(?:test|spec)\./.test(entry.name)) continue;
      const text = readFileSync(full, "utf8");
      if (!text.includes(".postMessage(")) continue;
      for (const match of text.matchAll(tailPostMessage)) {
        const segment = match[0];
        if (segment.length > 260 || segment.includes("}")) continue;
        if (/(?:worker|self|scope|ctx|port[12]|messageHandlers\.burette)\.postMessage\s*\($/.test(segment)) continue;
        const line = text.slice(0, match.index).split("\n").length;
        offenders.push(`${relative(root, full)}:${line}: ${segment.replace(/\s+/g, " ")}`);
      }
    }
  };
  for (const dir of scanRoots) walk(dir);
  assert.deepEqual(offenders, [], `Window postMessage must not be in tail-call position:\n${offenders.join("\n")}`);
}

// Sandboxed ligand-card iframes run with an opaque ("null") origin, where
// fetch("styles/...") against asset:// or http://asset.localhost is blocked by
// CORS. styles/bundle.js preloads styles/index.json and styles/*.css via a
// classic <script> tag and must stay in sync with those source files.
{
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const lidDir = join(root, "apps/desktop/public/interaction-diagram");
  const html = readFileSync(join(lidDir, "index.html"), "utf8");
  const bundleTag = '<script src="styles/bundle.js"></script>';
  const appTag = '<script src="app.js"></script>';
  assert.ok(html.includes(bundleTag), "interaction-diagram/index.html must load styles/bundle.js");
  assert.ok(
    html.indexOf(bundleTag) < html.indexOf(appTag),
    "styles/bundle.js must load before app.js in interaction-diagram/index.html",
  );
  const sandbox = { window: {} };
  runInNewContext(readFileSync(join(lidDir, "styles/bundle.js"), "utf8"), sandbox);
  const expectedStyles = JSON.parse(readFileSync(join(lidDir, "styles/index.json"), "utf8"));
  assert.deepEqual(structuredClone(sandbox.window.LID_STYLES), expectedStyles);
  const expectedCss = {};
  for (const [id, style] of Object.entries(expectedStyles)) {
    if (style && style.css) {
      expectedCss[id] = readFileSync(join(lidDir, `styles/${id}.css`), "utf8");
    }
  }
  assert.deepEqual(structuredClone(sandbox.window.LID_STYLE_CSS), expectedCss);
}

console.log("viewer bridge message contract tests passed");
