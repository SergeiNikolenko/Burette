#!/usr/bin/env bun
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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
const animationFrames = [];
const schedulerHarness = new Function(
  "requestAnimationFrame", "setTimeout", "getComputedStyle",
  `${schedulerBlock}
   return {
     scheduleViewerResize,
     setHostVisible(value) { hostViewerVisible = value; },
   };`,
)(
  callback => { animationFrames.push(callback); return animationFrames.length; },
  () => { throw new Error("viewport geometry must not wait for a trailing timer"); },
  () => ({ display: "block", visibility: "visible" }),
);
const tick = () => {
  const pending = animationFrames.splice(0);
  pending.forEach(callback => callback());
};
let bounds = { width: 800, height: 600 };
const applied = [];
let layoutBroadcasts = 0;
const container = { parentElement: null, getBoundingClientRect: () => bounds };
const fakeViewer = {
  handleResize: () => { layoutBroadcasts++; },
  plugin: {
    canvas3dContext: { canvas: { parentElement: container } },
    // The PluginContext path applies geometry without a layout broadcast.
    handleResize: () => { applied.push({ ...bounds }); },
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
}
assert.equal(layoutBroadcasts, 0, "geometry changes must not fan out through the Mol* UI layout");
schedulerHarness.scheduleViewerResize(fakeViewer);
tick();
assert.equal(applied.length, 60, "unchanged visible geometry is deduplicated");
bounds = { width: 400, height: 500 };
schedulerHarness.scheduleViewerResize(fakeViewer);
schedulerHarness.setHostVisible(false);
tick();
assert.equal(applied.length, 60, "hiding a tab cancels queued work");
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

console.log("viewer resize contract OK: 60 continuous frames, coalesced geometry and hidden-tab guards");
