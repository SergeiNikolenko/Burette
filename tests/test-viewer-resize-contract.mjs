#!/usr/bin/env bun
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { patchMolstarResizeDraw } from "../scripts/molstar-resize-draw.mjs";
import { BuretteResizeInteraction } from "../scripts/molstar-resize-interaction.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const [viewer, filePage, viewerFrame] = await Promise.all([
  readFile(join(repoRoot, "PreviewExtension/Web/viewer.js"), "utf8"),
  readFile(join(repoRoot, "apps/desktop/src/components/editor-area/page-kinds/file.tsx"), "utf8"),
  readFile(join(repoRoot, "apps/desktop/src/components/editor-area/viewer-frame.tsx"), "utf8"),
]);

// A window resize reaches Mol* through the container ResizeObserver, the window
// handler and the host's BuretteHandleResize at once. All three must land in the
// one scheduler that coalesces them, or the viewer redraws several times per
// resize step - measured at roughly 2.5 handleResize calls per step.
const observerBlock = viewer.slice(
  viewer.indexOf("function installViewerResizeObserver(viewer)"),
  viewer.indexOf("const DEFAULT_VIEWER_UI_SCALE"),
);
assert.ok(observerBlock.length > 0, "installViewerResizeObserver must exist");
assert.match(
  observerBlock,
  /scheduleViewerResize\(viewer\);/u,
  "the container observer must schedule through scheduleViewerResize",
);
assert.doesNotMatch(
  observerBlock,
  /viewer\.handleResize\?\.\(\);/u,
  "the container observer must not call handleResize directly",
);

// A viewer whose container has collapsed - a hidden keep-alive tab - has no
// pixels to redraw, and resizing it multiplied the work of every window resize.
assert.match(viewer, /function viewerCanvasIsVisible\(viewer\)/u);
const visibilityHelper = viewer.slice(
  viewer.indexOf("function viewerCanvasIsVisible(viewer)"),
  viewer.indexOf("function scheduleViewerResize(viewer"),
);
assert.match(
  visibilityHelper,
  /getComputedStyle\(node\)/u,
  "visibility must include CSS state, not only non-zero geometry",
);
assert.match(
  visibilityHelper,
  /node = node\.parentElement/u,
  "visibility must include hidden keep-alive ancestors",
);
assert.match(visibilityHelper, /style\.display === 'none'/u);
assert.match(visibilityHelper, /style\.visibility === 'hidden'/u);
assert.match(
  viewer,
  /if \(!viewerCanvasIsVisible\(viewer\)\) return;/u,
  "scheduleViewerResize must skip viewers whose container is collapsed",
);
assert.match(
  viewer,
  /if \(!viewerCanvasIsVisible\(target\)\) return;/u,
  "a queued resize must be cancelled if its tab becomes hidden before the frame runs",
);
assert.match(
  viewer,
  /target === resizeState\.appliedViewer/u,
  "size deduplication must not suppress the first resize of a different viewer",
);
assert.match(
  viewer,
  /if \(!hostViewerVisible\) return false;/u,
  "the iframe must honor visibility reported by its host page",
);
assert.match(viewer, /body\.type === 'viewerVisibilityChanged'/u);
assert.match(filePage, /visible: isActive && frameActive/u);
assert.match(viewerFrame, /onViewerLoad\?\.\(event\.currentTarget, active\)/u);
assert.match(filePage, /const stagingIframeRef = useRef<HTMLIFrameElement>\(null\)/u);
assert.match(filePage, /postViewerVisibility\(iframeRef\.current, true\)/u);
assert.match(filePage, /postViewerVisibility\(stagingIframeRef\.current, false\)/u);
assert.match(filePage, /sourceSession\?\.sourcePreview\?\.activeSlot/u);
assert.match(filePage, /stagingIframeRef=\{stagingIframeRef\}/u);

// Exercise the production scheduler, not just its call-site strings. Host,
// window and observer notifications must follow a continuous gesture before
// release, coalesce within a frame, and apply the last geometry in that frame.
const schedulerBlock = viewer.slice(
  viewer.indexOf("const resizeState = {"),
  viewer.indexOf("  let viewerResizeObserver = null;"),
);
const hostGestureHandler = viewer.slice(
  viewer.indexOf("    if (event.source === window.parent && body.type === 'hostLayoutGesture')"),
  viewer.indexOf("    if (body.type === 'workspaceHistoryCommand')"),
);
const animationFrames = [];
const makeScheduler = new Function(
  "requestAnimationFrame", "setTimeout", "getComputedStyle", "window",
  `${schedulerBlock}
   return {
     scheduleViewerResize,
     setHostVisible(value) { hostViewerVisible = value; },
     setHostGesture(activeViewer, active) {
       const event = { source: window.parent }, body = { type: 'hostLayoutGesture', active };
       ${hostGestureHandler}
     },
   };`,
);
const schedulerHarness = makeScheduler(
  callback => { animationFrames.push(callback); return animationFrames.length; },
  () => { throw new Error("viewport geometry must not wait for a trailing timer"); },
  () => ({ display: "block", visibility: "visible" }),
  {},
);
const tick = () => {
  const pending = animationFrames.splice(0);
  pending.forEach(callback => callback());
};
let bounds = { width: 800, height: 600 };
const applied = [];
let layoutBroadcasts = 0;
let painted = null;
let draws = 0;
const container = { parentElement: null, getBoundingClientRect: () => bounds };
const fakeViewer = {
  handleResize: () => { layoutBroadcasts++; },
  plugin: {
    canvas3dContext: { canvas: { parentElement: container } },
    // The PluginContext path applies geometry without a layout broadcast.
    handleResize: () => { painted = null; applied.push({ ...bounds }); },
    canvas3d: {
      draw: options => {
        assert.deepEqual(options, { force: true, isSynchronous: true });
        painted = { ...bounds };
        draws++;
      },
      tick: () => { throw new Error("resizing must not advance animation time"); },
      resume: () => { throw new Error("resizing must not start another animation loop"); },
    },
    layout: { events: { updated: { next: () => { layoutBroadcasts++; } } } },
  },
};
schedulerHarness.setHostVisible(false);
schedulerHarness.scheduleViewerResize(fakeViewer);
assert.equal(animationFrames.length, 0, "a hidden tab must not enqueue resize work");
schedulerHarness.setHostVisible(true);
for (let frame = 0; frame < 60; frame++) {
  const before = applied.length;
  // The notifications see successive widths, as can happen with nested panes.
  bounds = { width: 800 - frame * 6, height: 600 };
  schedulerHarness.scheduleViewerResize(fakeViewer);
  bounds = { width: bounds.width - 2, height: 600 - frame };
  schedulerHarness.scheduleViewerResize(fakeViewer);
  schedulerHarness.scheduleViewerResize(fakeViewer);
  assert.equal(animationFrames.length, 1, "duplicate channels share one pending frame");
  assert.equal(applied.length, before, "resize is batched, not synchronous per event");
  tick();
  assert.equal(applied.length, before + 1, "each drag frame updates before release");
  assert.deepEqual(applied.at(-1), bounds, "apply the latest viewport, not first event bounds");
  assert.deepEqual(painted, bounds, "the resized buffer must be painted before returning to WebKit");
}
assert.equal(layoutBroadcasts, 0, "geometry changes must not fan out through the Mol* UI layout");
schedulerHarness.scheduleViewerResize(fakeViewer);
tick();
assert.equal(applied.length, 60, "unchanged visible geometry is deduplicated");
assert.equal(draws, 60, "unchanged geometry must not force another scene draw");
bounds = { width: 400, height: 500 };
schedulerHarness.scheduleViewerResize(fakeViewer);
schedulerHarness.setHostVisible(false);
tick();
assert.equal(applied.length, 60, "hiding a tab cancels queued work");
assert.equal(draws, 60, "hidden viewers must not draw");
schedulerHarness.setHostVisible(true);
schedulerHarness.scheduleViewerResize(fakeViewer);
tick();
assert.deepEqual(applied.at(-1), bounds, "reactivation catches up to current geometry");
let fallbackResizes = 0;
const adapter = {
  handleResize: () => { fallbackResizes++; },
  plugin: { canvas3dContext: fakeViewer.plugin.canvas3dContext },
};
schedulerHarness.scheduleViewerResize(adapter);
tick();
assert.equal(fallbackResizes, 1, "a new viewer at the same size still resizes through its adapter");

// With the real interaction controller, only CSS presentation follows the live
// bounds; native GL targets resize once, and the cleared buffer is painted in
// that same callback. Internal Mol* resize paths cannot bypass the controller.
const originalSetTimeout = globalThis.setTimeout, originalClearTimeout = globalThis.clearTimeout;
const settled = new Map();
let timerId = 0;
globalThis.setTimeout = callback => { settled.set(++timerId, callback); return timerId; };
globalThis.clearTimeout = id => settled.delete(id);
try {
  const messages = [];
  const live = makeScheduler(
    callback => { animationFrames.push(callback); return animationFrames.length; },
    () => { throw Error("scheduler does not own settling timers"); },
    () => ({ display: "block", visibility: "visible" }),
    { molstar: { BuretteResizeInteraction }, parent: { postMessage: value => messages.push(value) } },
  );
  Object.assign(fakeViewer.plugin.canvas3dContext.canvas, { width: 1600, height: 1200, style: { width: '800px', height: '600px' } });
  const start = applied.length;
  live.scheduleViewerResize(fakeViewer); tick();
  for (let i = 0; i < 60; i++) {
    bounds = { width: 500 + i * 2, height: 400 + i };
    live.scheduleViewerResize(fakeViewer); tick();
    fakeViewer.plugin.handleResize();
    assert.equal(applied.length, start + 1, "GL targets stay intact throughout the gesture");
  }
  [...settled.values()].forEach(callback => callback()); settled.clear();
  assert.equal(applied.length, start + 2);
  assert.deepEqual(painted, bounds, "the final resize must draw atomically");
  assert.equal(messages.at(-1).body.frames, 60);
  const beforeHold = applied.length;
  const originalHeldResize = fakeViewer.plugin.handleResize;
  live.setHostGesture(fakeViewer, true);
  const replacementCanvas = { width: 400, height: 300, style: {} };
  const replacementResize = () => {};
  const replacement = { plugin: { canvas3dContext: { canvas: replacementCanvas }, handleResize: replacementResize } };
  live.setHostGesture(replacement, true);
  bounds = { width: 640, height: 480 };
  live.scheduleViewerResize(fakeViewer); tick();
  [...settled.values()].forEach(callback => callback()); settled.clear();
  fakeViewer.plugin.handleResize();
  assert.equal(applied.length, beforeHold, 'paused host gestures keep internal Mol* resize gated');
  live.setHostGesture(replacement, false); tick();
  [...settled.values()].forEach(callback => callback()); settled.clear();
  assert.equal(fakeViewer.plugin.handleResize, originalHeldResize, 'release includes a previous active viewer');
  assert.equal(replacement.plugin.handleResize, replacementResize);
  assert.equal(applied.length, beforeHold + 1, 'host release restores and draws exactly once');
  assert.deepEqual(painted, bounds);
  live.scheduleViewerResize(fakeViewer); tick();
  const beforeHidden = applied.length;
  bounds = { width: 700, height: 500 };
  live.scheduleViewerResize(fakeViewer); tick();
  live.setHostVisible(false);
  [...settled.values()].forEach(callback => callback()); settled.clear();
  assert.equal(applied.length, beforeHidden, "settling a hidden viewer does not draw");
  live.setHostVisible(true);
  live.scheduleViewerResize(fakeViewer); tick();
  assert.equal(settled.size, 1, "reactivation at the same bounds must still catch up");
  [...settled.values()].forEach(callback => callback()); settled.clear();
  assert.deepEqual(painted, bounds);
} finally {
  BuretteResizeInteraction.dispose(fakeViewer);
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
}

const canvasSource = await readFile(join(repoRoot, "node_modules/molstar/lib/mol-canvas3d/canvas3d.js"), "utf8");
const patched = patchMolstarResizeDraw(canvasSource);
assert.equal(patched.replace("            requestDraw,\n            draw,\n            tick,", "            requestDraw,\n            tick,"), canvasSource);
assert.throws(() => patchMolstarResizeDraw(patched), /Canvas3D changed/u, "an upstream change must fail closed");

console.log("viewer resize contract OK: 60 continuous frames, coalesced geometry and hidden-tab guards");
