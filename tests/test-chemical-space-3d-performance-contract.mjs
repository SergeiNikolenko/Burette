#!/usr/bin/env bun
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  boundedEdgePositions,
  cameraAwarePointIndices,
  positionsForIndices,
  representativePointIndices,
  sourceRecordIdsInProjectedPolygon,
} from "../apps/desktop/src/lib/chemical-space-3d-lod.ts";

const source = readFileSync(
  new URL("../apps/desktop/src/components/chemical-space-3d.tsx", import.meta.url),
  "utf8",
);
const panelSource = readFileSync(
  new URL("../apps/desktop/src/components/chemical-space-panel.tsx", import.meta.url),
  "utf8",
);

assert.doesNotMatch(
  source,
  /sourceRecordIds\.join\(/u,
  "3D renders must not allocate an O(N) dependency string",
);
assert.match(
  source,
  /const hasClusters = useMemo\([\s\S]*clusterIds\.some\(/u,
  "cluster presence may scan once when the cluster array changes, not on every pointer update",
);
assert.doesNotMatch(
  source,
  /new Map\(sourceRecordIds\.map\(/u,
  "the source-id lookup must not allocate an additional O(N) tuple array",
);
assert.match(source, /const MAX_3D_RENDER_POINTS = 40_000;/u);
assert.match(source, /const MAX_3D_RENDER_EDGES = 40_000;/u);
assert.match(source, /const MAX_3D_RENDER_CLIFFS = 20_000;/u);
assert.match(source, /boundedEdgePositions\(nextPositions, treeEdges, MAX_3D_RENDER_EDGES\)/u);
assert.match(source, /boundedEdgePositions\(nextPositions, edges, MAX_3D_RENDER_CLIFFS\)/u);
assert.match(source, /cameraAwarePointIndices\(/u);
assert.match(source, /scheduleLodRefinement\(0\)/u);
assert.match(source, /sourceRecordIdsInProjectedPolygon\(/u);
assert.doesNotMatch(source, /projectedRef/u);
assert.match(source, /simplifyLassoPolygon\(lassoRef\.current\)/u);
assert.match(source, /lassoRef\.current\.push\(point\)/u);
assert.match(source, /requestAnimationFrame\(\(\) => \{/u);

const rebuildIndex = source.slice(
  source.indexOf("const rebuildProjectedIndex = () =>"),
  source.indexOf("const renderView ="),
);
assert.match(rebuildIndex, /for \(const sourceIndex of displayedIndices\)/u);
assert.doesNotMatch(
  rebuildIndex,
  /positionsRef\.current\.(?:map|flatMap|forEach)/u,
  "camera movement must project only the bounded display set",
);
assert.match(rebuildIndex, /projectedBuckets/u);

const draw = source.slice(
  source.indexOf("const draw = () =>"),
  source.indexOf("const projectionSnapshot ="),
);
assert.doesNotMatch(
  draw,
  /rebuildProjectedIndex|projectPoints/u,
  "selection and hover redraws must not rebuild the camera index",
);

const nearest = source.slice(
  source.indexOf("const nearestProjectedPoint ="),
  source.indexOf("const hoverNearest ="),
);
assert.match(nearest, /projectedBuckets/u);
assert.doesNotMatch(
  nearest,
  /for \(const candidate of projectedRef\.current\)/u,
  "hover must query spatial buckets instead of scanning every displayed point",
);
assert.match(
  source,
  /if \(sourceRecordId === hoveredRef\.current\) return sourceRecordId;/u,
  "pointer movement over the same point must not flood React and Grid",
);
assert.match(panelSource, /const aligned3DClusterIds = useMemo\(/u);
assert.match(panelSource, /const pointColors3D = useMemo\(/u);
assert.match(panelSource, /const cliffEdges3D = useMemo\(/u);

const representativeIndices = representativePointIndices(250_000, 40_000);
assert.equal(representativeIndices.length, 40_000);
assert.equal(representativeIndices[0], 0);
assert.equal(representativeIndices.at(-1), 249_999);
assert.equal(new Set(representativeIndices).size, 40_000);

const positions = Array.from({ length: 50_000 }, (_, index) => [
  ((index % 500) / 499) * 1.8 - 0.9,
  ((Math.floor(index / 500) % 100) / 99) * 1.8 - 0.9,
  (index % 11) / 100,
]);
const identitySnapshot = {
  elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  width: 1_000,
  height: 800,
};
let lodYields = 0;
const identityLod = await cameraAwarePointIndices(
  positions,
  identitySnapshot,
  4_000,
  () => false,
  async () => {
    lodYields += 1;
  },
);
assert.ok(identityLod.length > 0 && identityLod.length <= 4_000);
assert.ok(lodYields > 0, "large camera refinement must yield between chunks");

const shiftedSnapshot = {
  ...identitySnapshot,
  elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -0.8, 0, 0, 1],
};
const shiftedLod = await cameraAwarePointIndices(
  positions,
  shiftedSnapshot,
  4_000,
  () => false,
  async () => {},
);
assert.notDeepEqual(
  shiftedLod.slice(0, 100),
  identityLod.slice(0, 100),
  "camera movement must refine to a different visible molecule set",
);

const edges = Array.from({ length: 250_000 }, (_, index) => [
  index % positions.length,
  (index + 1) % positions.length,
]);
const edgePositions = boundedEdgePositions(positions, edges, 40_000);
assert.ok(edgePositions.length <= 40_000 * 6);
assert.equal(edgePositions.length % 6, 0);
assert.equal(positionsForIndices(positions, representativeIndices.slice(0, 10)).length, 30);

const sourceRecordIds = positions.map((_, index) => index + 1);
let selectionYields = 0;
const selected = await sourceRecordIdsInProjectedPolygon(
  positions,
  sourceRecordIds,
  identitySnapshot,
  [
    { x: 500, y: 0 },
    { x: 1_000, y: 0 },
    { x: 1_000, y: 800 },
    { x: 500, y: 800 },
  ],
  100_000,
  () => false,
  async () => {
    selectionYields += 1;
  },
);
assert.ok(selected.length > 20_000);
assert.ok(
  selected.some((sourceRecordId) => sourceRecordId > 40_000),
  "3D lasso must include molecules outside the initial representative set",
);
assert.ok(selectionYields > 0, "large lasso selection must yield between chunks");

console.log("chemical-space 3D performance contract OK");
