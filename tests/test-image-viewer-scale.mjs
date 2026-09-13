#!/usr/bin/env bun
// The image viewer's scale counts logical (CSS) pixels: 100% lays one CSS
// pixel per intrinsic pixel / devicePixelRatio, so a @2x screenshot opens at
// the size it was captured at instead of twice that on a Retina screen. The
// canvas backing store still covers the CSS box at device resolution, capped
// at the bitmap's intrinsic size, and images open fitted to the viewport.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  frameBackingScale,
  frameCssSize,
  logicalFrameSize,
  normalizePixelRatio,
} from "../apps/desktop/src/lib/image-geometry.ts";
import { getFileViewerFitWidthScale } from "../apps/desktop/src/components/ui/file-viewer-fit-width-motion.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFileSync(join(root, path), "utf8");

const retinaScreenshot = { width: 2880, height: 1800 };

// Pixel ratio normalisation: anything unusable reads as a 1x screen.
assert.equal(normalizePixelRatio(2), 2);
assert.equal(normalizePixelRatio(1.5), 1.5);
assert.equal(normalizePixelRatio(undefined), 1);
assert.equal(normalizePixelRatio(0), 1);
assert.equal(normalizePixelRatio(-2), 1);
assert.equal(normalizePixelRatio(Number.NaN), 1);
assert.equal(normalizePixelRatio(Number.POSITIVE_INFINITY), 1);

// A @2x capture is half as many CSS pixels as it has raster pixels.
assert.deepEqual(logicalFrameSize(retinaScreenshot, 2), {
  width: 1440,
  height: 900,
});
assert.deepEqual(logicalFrameSize(retinaScreenshot, 1), retinaScreenshot);
assert.deepEqual(logicalFrameSize(retinaScreenshot, 0), retinaScreenshot);

// 100% on a Retina screen is the logical size; the pixel ratio defaults to 1
// for callers that already work in logical pixels.
assert.deepEqual(frameCssSize(retinaScreenshot, 1, 0, 2), {
  width: 1440,
  height: 900,
});
assert.deepEqual(frameCssSize(retinaScreenshot, 1, 0), retinaScreenshot);
assert.deepEqual(frameCssSize(retinaScreenshot, 0.5, 0, 2), {
  width: 720,
  height: 450,
});
assert.deepEqual(frameCssSize(retinaScreenshot, 2, 0, 2), retinaScreenshot);
// Rotation swaps the axes after the ratio is applied.
assert.deepEqual(frameCssSize(retinaScreenshot, 1, 90, 2), {
  width: 900,
  height: 1440,
});
assert.deepEqual(frameCssSize(retinaScreenshot, 1, 270, 2), {
  width: 900,
  height: 1440,
});
assert.deepEqual(frameCssSize(retinaScreenshot, 1, 180, 2), {
  width: 1440,
  height: 900,
});

// The canvas backing covers the CSS box at device resolution: CSS x dpr is
// the display scale in intrinsic pixels, whatever the screen, capped at the
// bitmap's own resolution (one resample generation).
for (const pixelRatio of [1, 2, 3]) {
  for (const scale of [0.25, 0.5, 1]) {
    const css = frameCssSize(retinaScreenshot, scale, 0, pixelRatio);
    const backing = frameBackingScale(scale);
    assert.equal(
      Math.round(css.width * pixelRatio),
      Math.round(retinaScreenshot.width * backing),
      `backing covers the CSS box at ${scale}x on a ${pixelRatio}x screen`,
    );
  }
}
assert.equal(frameBackingScale(1), 1);
assert.equal(frameBackingScale(0.43), 0.43);
assert.equal(frameBackingScale(2), 1);
assert.equal(frameBackingScale(5), 1);
assert.equal(frameBackingScale(0), 1);
assert.equal(frameBackingScale(Number.NaN), 1);

// Fit-width is solved against the logical width, so its readout sits on the
// same axis as 100%: a 1440pt-wide capture in a 1200px pane (32px of stage
// padding) reads 81%, and the resulting CSS box actually fits the pane.
const paneWidth = 1200;
const stageInlinePadding = 32;
const fitScale = getFileViewerFitWidthScale({
  availableInlineSize: paneWidth,
  contentInlineSize: logicalFrameSize(retinaScreenshot, 2).width,
  stageInlinePadding,
});
assert.equal(Math.round(fitScale * 100), 81);
assert.equal(
  Math.round(frameCssSize(retinaScreenshot, fitScale, 0, 2).width),
  paneWidth - stageInlinePadding,
);
// Solved against the raster width instead, the same pane would read 41% and
// the readout would disagree with the 100% button by the pixel ratio.
const rasterFitScale = getFileViewerFitWidthScale({
  availableInlineSize: paneWidth,
  contentInlineSize: retinaScreenshot.width,
  stageInlinePadding,
});
assert.equal(Math.round(rasterFitScale * 100), 41);
assert.equal(Math.round((fitScale / rasterFitScale) * 10) / 10, 2);

// Source pins: the route no longer forces natural size, the scale hook
// divides by the tracked pixel ratio, the frame code derives its backing from
// the display scale instead of multiplying by dpr again, and the percentage
// readout is a live reset button.
const fileViewerRoute = source(
  "apps/desktop/src/components/ui/file-viewer-route.tsx",
);
assert.doesNotMatch(
  fileViewerRoute,
  /<ImageResourceContent[\s\S]{0,300}defaultScale=/,
);

const hooks = source("apps/desktop/src/components/ui/image-viewer-hooks.ts");
assert.match(hooks, /const pixelRatio = useImageDevicePixelRatio\(\);/);
assert.match(hooks, /\) \/ pixelRatio;/);
assert.match(hooks, /contentInlineSize: widestFrameLogicalWidth,/);
assert.match(hooks, /\(resolution: \$\{getImageDevicePixelRatio\(\)\}dppx\)/);

const frame = source("apps/desktop/src/components/ui/image-viewer-frame.tsx");
assert.match(
  frame,
  /const rasterDeviceScale = frameBackingScale\(rasterScale\);/,
);
assert.match(frame, /const renderScale = frameBackingScale\(rasterScale\);/);
assert.doesNotMatch(frame, /Math\.min\(rasterScale \* (?:dpr|pixelRatio), 1\)/);
assert.match(
  frame,
  /const layoutFrameRect = frameCssSize\(\n\s+descriptor\.intrinsicSize,\n\s+layoutScale,\n\s+rotation,\n\s+dpr,\n\s+\);/,
);

const virtualization = source(
  "apps/desktop/src/components/ui/image-viewer-virtualization.ts",
);
assert.match(
  virtualization,
  /frameCssSize\(\n\s+frame\.intrinsicSize,\n\s+scale,\n\s+rotation,\n\s+pixelRatio,\n\s+\)/,
);

const content = source(
  "apps/desktop/src/components/ui/image-viewer-content.tsx",
);
assert.match(content, /pixelRatio,\n\s+\}\),\n\s+\[frameSource\.frames, pixelRatio, rotation, scale\]/);
assert.match(content, /contentInlineSize: widestFrameLogicalWidth,/);
assert.match(content, /setViewerScale\(1\);/);
assert.equal((content.match(/onReset: resetScale,/g) ?? []).length, 2);
assert.equal((content.match(/onFit: fitWidth,/g) ?? []).length, 2);

console.log("image viewer scale ok");

// Run the scale hook, not a duplicate of its formula: a single tall image must
// fit both axes, including below the manual zoom floor; explicit zoom remains.
{
const { Window } = await import('happy-dom');
const React = await import('react');
const dom = new Window({ url: 'http://localhost/' });
Object.assign(globalThis, { window: dom, document: dom.document, HTMLElement: dom.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import('react-dom/client');
const { useImageViewerScale } = await import('../apps/desktop/src/components/ui/image-viewer-hooks.ts');
const root = createRoot(document.createElement('div'));
let current;
const source = { frames: [{ intrinsicSize: { width: 1200, height: 16000 } }] };
function ScaleHarness({ height }) {
  current = useImageViewerScale(source, undefined, undefined, undefined, 900, height);
  return null;
}
await React.act(async () => root.render(React.createElement(ScaleHarness, { height: 600 })));
assert.ok(current.scale < 0.1, 'automatic fit can be smaller than manual zoom minimum');
assert.ok(16000 / current.pixelRatio * current.scale <= 568, 'portrait fits available height');
assert.equal(current.isFitWidth, false, 'height fit does not use width-only surface animation');
await React.act(async () => current.rotateClockwise());
assert.ok(16000 / current.pixelRatio * current.scale <= 900, 'rotated image fits width');
await React.act(async () => current.setViewerScale(1));
await React.act(async () => root.render(React.createElement(ScaleHarness, { height: 400 })));
assert.equal(current.scale, 1, 'explicit 100% survives resize');
await React.act(async () => current.setViewerScale(null));
assert.ok(1200 / current.pixelRatio * current.scale <= 368, 'Fit returns to both-axis containment');
await React.act(async () => root.unmount());
await dom.happyDOM.abort();
console.log('image viewport hook integration passed');
}
