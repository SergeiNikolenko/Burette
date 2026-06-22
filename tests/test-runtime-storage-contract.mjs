#!/usr/bin/env node
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

async function runtimeWebFiles(dir = new URL("../PreviewExtension/Web/", import.meta.url), prefix = "") {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    const url = new URL(entry.name, dir);
    if (entry.isDirectory()) return runtimeWebFiles(new URL(`${entry.name}/`, dir), name);
    return name;
  }));
  return files.flat().sort();
}

function storageConstants(sourceText) {
  return [...sourceText.matchAll(/const\s+([A-Z0-9_]+(?:_STORAGE_KEY|_KEY_PREFIX))\s*=\s*'([^']+)'/g)]
    .map((match) => [match[1], match[2]])
    .sort(([left], [right]) => left.localeCompare(right));
}

function sortedPairs(pairs) {
  return pairs.toSorted(([left], [right]) => left.localeCompare(right));
}

function literalStorageKeys(sourceText) {
  return [...new Set([...sourceText.matchAll(/(?:localStorage|sessionStorage)(?:\?\.)?\.(?:getItem|setItem|removeItem)\('([^']+)'/g)]
    .map((match) => match[1]))].sort();
}

const [viewer, gridViewer] = await Promise.all([
  source("PreviewExtension/Web/viewer.js"),
  source("PreviewExtension/Web/grid-viewer.js"),
]);

const storageRuntimeFiles = [];
for (const file of await runtimeWebFiles()) {
  const text = await source(`PreviewExtension/Web/${file}`);
  if (/\b(?:localStorage|sessionStorage)\b/.test(text)) storageRuntimeFiles.push(file);
}
assert.deepEqual(storageRuntimeFiles, ["grid-viewer.js", "viewer.js"]);

assert.deepEqual(storageConstants(viewer), sortedPairs([
  ["SDF_CONTEXT_COLOR_STORAGE_KEY", "buret.sdf.contextColor"],
  ["SDF_CONTEXT_OPACITY_STORAGE_KEY", "buret.sdf.contextOpacity"],
  ["SDF_CONTEXT_STYLE_STORAGE_KEY", "buret.sdf.contextStyle"],
  ["SDF_POSE_MODE_STORAGE_KEY", "buret.sdf.poseMode"],
  ["VIEWER_THEME_STORAGE_KEY", "buret.viewer.theme"],
  ["XYZ_FRAME_MODE_STORAGE_KEY", "buret.xyz.frameMode"],
]));

assert.deepEqual(storageConstants(gridViewer), sortedPairs([
  ["CARD_MIN_STORAGE_KEY", "buret.grid.cardMin"],
  ["CARD_RENDERER_STORAGE_KEY", "buret.grid.cardRenderer"],
  ["GRID_VIEW_MODE_STORAGE_KEY", "buret.grid.viewMode"],
  ["RDKIT_USE_INPUT_COORDS_STORAGE_KEY", "buret.grid.rdkitUseInputCoords"],
  ["TABLE_HIDDEN_COLUMNS_STORAGE_KEY", "buret.grid.tableHiddenColumns"],
]));

assert.deepEqual(literalStorageKeys(viewer), [
  "buret.dockingPoseControls.position",
  "buret.dockingPoseControls.position.version",
  "buret.toolbar.collapsed",
  "buret.toolbar.collapsed.version",
  "buret.toolbar.position",
  "buret.toolbar.position.version",
]);
assert.deepEqual(literalStorageKeys(gridViewer), []);

assert.match(viewer, /return `\$\{SDF_CONTEXT_STYLE_STORAGE_KEY\}\.\$\{documentId\}`/);
assert.match(viewer, /return `\$\{SDF_CONTEXT_STYLE_STORAGE_KEY\}\.fallback-\$\{stableTextHash\(fallback\)\}`/);
assert.match(viewer, /return `\$\{SDF_CONTEXT_OPACITY_STORAGE_KEY\}\.\$\{documentId\}`/);
assert.match(viewer, /return `\$\{SDF_CONTEXT_COLOR_STORAGE_KEY\}\.\$\{documentId\}`/);
assert.doesNotMatch(viewer, /buret\.xyzrender\.popover\.open/);
assert.match(viewer, /return `buret\.structureScene\.poseMode\.\$\{documentId\}`/);
assert.match(viewer, /return `buret\.structureScene\.poseMode\.fallback-\$\{stableTextHash\(fallback\)\}`/);
assert.match(viewer, /return `burrete\.dockingPose\.\$\{documentId\}`/);
assert.match(viewer, /return `burrete\.dockingPose\.fallback-\$\{stableTextHash\(fallback\)\}`/);
assert.match(viewer, /return `burrete\.trajectoryControl\.\$\{documentId\}`/);
assert.match(viewer, /return `burrete\.trajectoryControl\.fallback-\$\{stableTextHash\(fallback\)\}`/);
assert.match(viewer, /return `\$\{trajectoryControlStorageKey\(config, prepared\)\}\.fps\.v1`/);

assert.doesNotMatch(`${viewer}\n${gridViewer}`, /['"`]burette\./i);

console.log("runtime storage contract tests passed");
