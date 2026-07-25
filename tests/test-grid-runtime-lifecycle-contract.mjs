#!/usr/bin/env bun
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(
  join(repoRoot, "apps/desktop/src-tauri/src/preview/runtime_grid.rs"),
  "utf8",
);

const registerAt = source.indexOf(".register(");
const manifestAt = source.indexOf('runtime.join("manifest.json")');

assert.ok(registerAt >= 0, "Grid runtime must register its backing store");
assert.ok(manifestAt >= 0, "Grid runtime must write its manifest");
assert.ok(
  registerAt > manifestAt,
  "Grid runtime must not enter the registry until all runtime artifacts are durable",
);
assert.match(
  source,
  /struct PendingGridStore[\s\S]*?impl Drop for PendingGridStore/,
  "an uncommitted store needs a cleanup guard when artifact generation fails",
);

console.log("grid runtime lifecycle contract OK");
