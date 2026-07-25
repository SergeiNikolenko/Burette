#!/usr/bin/env bun
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const viewer = await readFile(join(repoRoot, "PreviewExtension/Web/viewer.js"), "utf8");

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
assert.match(
  viewer,
  /if \(!viewerCanvasIsVisible\(viewer\)\) return;/u,
  "scheduleViewerResize must skip viewers whose container is collapsed",
);

console.log("viewer resize contract OK");
