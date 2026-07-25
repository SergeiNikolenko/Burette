#!/usr/bin/env bun
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const gridViewer = await readFile(join(repoRoot, "PreviewExtension/Web/grid-viewer.js"), "utf8");

// The grid must fetch pages because the viewport asked for them. loadMoreRemote
// used to re-arm itself with setTimeout(0) for as long as hasMoreRows() was true,
// which loaded an entire collection - 400k rows with their molblocks for a 1 GB
// SDF - into the iframe heap with nobody scrolling.
assert.doesNotMatch(
  gridViewer,
  /setTimeout\(\(\)\s*=>\s*loadMoreRemote\(/u,
  "loadMoreRemote must not schedule itself; paging is driven by maybeLoadMore and pendingLoad",
);

// While the backend indexes, the poll refreshes counters only. Pointing it back at
// loadMoreRemote is what turned "show indexing progress" into "download everything".
assert.match(
  gridViewer,
  /if \(state\.indexing\) void pollIndexProgress\(cfg\);/u,
  "the index poll must call pollIndexProgress",
);
assert.match(
  gridViewer,
  /async function pollIndexProgress\(cfg\) \{/u,
  "pollIndexProgress must exist",
);
const pollBody = gridViewer.slice(
  gridViewer.indexOf("async function pollIndexProgress(cfg) {"),
  gridViewer.indexOf("async function initRDKit()"),
);
assert.match(pollBody, /limit: 1/u, "the index poll must request a single row, not a page of data");
assert.doesNotMatch(
  pollBody,
  /state\.rows\.push/u,
  "the index poll must not append rows",
);
assert.match(
  gridViewer,
  /state\.indexError = result\.indexError == null \? null : String\(result\.indexError\)/u,
  "backend indexing failures must remain distinct from a successfully ready index",
);
assert.match(gridViewer, /state\.bytesIndexed = Number\(result\.bytesIndexed/u);
assert.match(gridViewer, /state\.bytesTotal = Number\(result\.bytesTotal/u);
assert.match(
  gridViewer,
  /indexError: state\.indexError/u,
  "Chemical Space must receive the indexing failure instead of submitting compute",
);
assert.match(gridViewer, /bytesIndexed: state\.bytesIndexed/u);
assert.match(gridViewer, /bytesTotal: state\.bytesTotal/u);
assert.match(
  gridViewer,
  /indexStateKnown: false/u,
  "a bridge Grid must start fail-closed until config or the first page establishes index state",
);
assert.match(
  gridViewer,
  /state\.indexStateKnown && state\.indexReady && !state\.indexing && !state\.indexError/u,
  "all full-collection actions must reject an unknown or failed index",
);

// The demand-driven entry points stay in place.
for (const marker of [
  "function maybeLoadMore(cfg) {",
  "function maybeLoadMoreForRenderedRange(cfg, range) {",
]) {
  assert.ok(gridViewer.includes(marker), `${marker} must remain the paging entry point`);
}

console.log("grid paging contract OK");
