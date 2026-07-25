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
  /scheduleViewerResize\(viewer, 40\);/u,
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
  "a queued resize must be cancelled if its tab becomes hidden before the timer fires",
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

// Exercise the scheduler itself: a hidden tab queues no work, becoming visible
// schedules one resize even when its geometry matches the last observed size,
// and repeated notifications at that size are deduplicated.
const schedulerBlock = viewer.slice(
  viewer.indexOf("const resizeState = {"),
  viewer.indexOf("// Mol* commits a layout change"),
);
const animationFrames = [];
const timers = [];
const schedulerHarness = new Function(
  "requestAnimationFrame",
  "setTimeout",
  "clearTimeout",
  "getComputedStyle",
  `${schedulerBlock}
   return {
     scheduleViewerResize,
     setHostVisible(value) { hostViewerVisible = value; },
   };`,
)(
  (callback) => {
    animationFrames.push(callback);
    return animationFrames.length;
  },
  (callback) => {
    timers.push(callback);
    return timers.length;
  },
  () => {},
  () => ({ display: "block", visibility: "visible" }),
);
let resizeCount = 0;
const container = {
  parentElement: null,
  getBoundingClientRect: () => ({ width: 800, height: 600 }),
};
const fakeViewer = {
  handleResize: () => { resizeCount += 1; },
  plugin: { canvas3dContext: { canvas: { parentElement: container } } },
};
schedulerHarness.setHostVisible(false);
schedulerHarness.scheduleViewerResize(fakeViewer, 0);
assert.equal(animationFrames.length, 0, "a hidden tab must not enqueue resize work");
schedulerHarness.setHostVisible(true);
schedulerHarness.scheduleViewerResize(fakeViewer, 0);
animationFrames.shift()();
timers.shift()();
assert.equal(resizeCount, 1, "reactivating a hidden tab must resize it once");
schedulerHarness.scheduleViewerResize(fakeViewer, 0);
animationFrames.shift()();
timers.shift()();
assert.equal(resizeCount, 1, "unchanged visible geometry must be deduplicated");

console.log("viewer resize contract OK");
