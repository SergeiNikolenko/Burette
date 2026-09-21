#!/usr/bin/env bun
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  simplifyLassoPolygon,
  sourceRecordIdsInPolygon,
} from "../apps/desktop/src/lib/chemical-space-lasso.ts";
import {
  buildCameraScreenPointIndex,
  buildSpatialPointIndex,
  sourceRecordIdsInSpatialPolygon,
} from "../apps/desktop/src/lib/chemical-space-screen-index.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const panel = await readFile(
  join(repoRoot, "apps/desktop/src/components/chemical-space-panel.tsx"),
  "utf8",
);

const denseStroke = Array.from({ length: 4_096 }, (_, index) => ({
  x: index / 8,
  y: 20 + Math.sin(index / 24) * 3,
}));
const simplified = simplifyLassoPolygon(denseStroke);
assert.ok(simplified.length <= 128, "pointer sampling must not create a 4096-edge selection polygon");
assert.deepEqual(simplified[0], denseStroke[0]);
assert.deepEqual(simplified.at(-1), denseStroke.at(-1));

const points = [
  { x: 2, y: 2, sourceRecordId: 10 },
  { x: 8, y: 8, sourceRecordId: 11 },
  { x: 50, y: 50, sourceRecordId: 12 },
];
assert.deepEqual(
  sourceRecordIdsInPolygon(points, [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]),
  [10, 11],
);

const denseSpatial = buildSpatialPointIndex([
  { x: 50, y: 50, depth: 0, sourceRecordId: 20 },
  { x: 50.2, y: 50.2, depth: 0, sourceRecordId: 21 },
  { x: 200, y: 50, depth: 0, sourceRecordId: 22 },
]);
const coarse = buildCameraScreenPointIndex(
  denseSpatial,
  { width: 100, height: 100 },
  { zoom: 1, panX: 0, panY: 0 },
);
assert.equal(
  coarse.renderPoints.filter((point) => point.sourceRecordId === 20 || point.sourceRecordId === 21).length,
  1,
  "the overview should aggregate points sharing a screen cell",
);
const refined = buildCameraScreenPointIndex(
  denseSpatial,
  { width: 100, height: 100 },
  { zoom: 20, panX: 0, panY: 0 },
);
assert.deepEqual(
  new Set(refined.renderPoints.map((point) => point.sourceRecordId)),
  new Set([20, 21]),
  "zooming must refine a coarse aggregate into its hidden molecules",
);
const panned = buildCameraScreenPointIndex(
  denseSpatial,
  { width: 100, height: 100 },
  { zoom: 1, panX: -150, panY: 0 },
);
assert.ok(
  panned.renderPoints.some((point) => point.sourceRecordId === 22),
  "panning must query molecules outside the initial viewport",
);

// Dragging may translate the cloud but must never reshuffle it. Screen-anchored
// buckets used to hand a third of the cells to a different molecule per pixel of
// pan, which is what made the map shimmer under the cursor.
const clustered = buildSpatialPointIndex(Array.from({ length: 400 }, (_, index) => ({
  x: 40 + (index % 20) * 3.7 + (index % 7) * 0.4,
  y: 40 + Math.floor(index / 20) * 3.1 + (index % 5) * 0.3,
  depth: 0,
  sourceRecordId: index,
})));
const drawnAfterPan = (panX) => new Set(buildCameraScreenPointIndex(
  clustered,
  { width: 320, height: 240 },
  { zoom: 1, panX, panY: 0 },
).renderPoints.map((point) => point.sourceRecordId));
const drawnAtRest = drawnAfterPan(0);
assert.ok(drawnAtRest.size < 400, "the sample must aggregate, or the pan check proves nothing");
for (const offset of [1, 2, 5]) {
  assert.deepEqual(
    drawnAfterPan(offset),
    drawnAtRest,
    `panning ${offset}px must redraw the same molecules`,
  );
}
assert.deepEqual(
  new Set(sourceRecordIdsInSpatialPolygon(denseSpatial, [
    { x: 49, y: 49 },
    { x: 51, y: 49 },
    { x: 51, y: 51 },
    { x: 49, y: 51 },
  ], 100)),
  new Set([20, 21]),
  "lasso must select every molecule in an aggregate, not only its representative",
);
assert.equal(
  sourceRecordIdsInSpatialPolygon(denseSpatial, [
    { x: 49, y: 49 },
    { x: 51, y: 49 },
    { x: 51, y: 51 },
    { x: 49, y: 51 },
  ], 1).length,
  1,
  "lasso traversal must stop at the bridge limit instead of materializing every selected ID",
);

assert.match(
  panel,
  /sourceRecordIdsInSpatialPolygon\([\s\S]*?spatialIndexRef\.current,[\s\S]*?basePolygon,[\s\S]*?GRID_SELECTION_BRIDGE_LIMIT/u,
  "2D lasso must use the spatial tree instead of scanning every point against every polygon edge",
);
assert.match(panel, /buildCameraScreenPointIndex\(spatialIndex, viewport, camera\)/u);
assert.doesNotMatch(panel, /lassoRef\.current = \[\.\.\.lassoRef\.current, point\]/u);

console.log("chemical-space lasso contract OK");
