#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  classifyWebDemoError,
  classifyWebDemoOperation,
  safeCommandId,
} from "../apps/desktop/src/lib/web-demo-analytics.ts";

assert.equal(classifyWebDemoError(new Error("Failed to fetch structure")), "network");
assert.equal(classifyWebDemoError(new Error("WebGL renderer crashed")), "render");
assert.equal(classifyWebDemoError(new Error("Unsupported molecular format")), "unsupported_format");
assert.equal(classifyWebDemoError(new TypeError("Unexpected value")), "type_error");

assert.equal(classifyWebDemoOperation("Fetch 1ABC failed"), "fetch_structure");
assert.equal(classifyWebDemoOperation("Molstar viewer failed"), "render_structure");
assert.equal(classifyWebDemoOperation("Open /private/sample.sdf failed"), "open_structure");

assert.equal(safeCommandId("renderer-molstar"), "renderer_molstar");
assert.equal(safeCommandId("fetch-pdb-1ABC"), "fetch_pdb");
assert.equal(safeCommandId("draw-smiles-CC(=O)OC1=CC=CC=C1C(O)=O"), "draw_smiles");
assert.equal(safeCommandId("recent-/Users/private/secret.sdf"), "open_project_structure");

const source = await readFile(new URL("../apps/desktop/src/lib/web-demo-analytics.ts", import.meta.url), "utf8");
assert.match(source, /disableAutoTrack: true/u);
assert.match(source, /route: ANALYTICS_ROUTE/u);
assert.match(source, /injectSpeedInsights/u);
assert.match(source, /unhandledrejection/u);
assert.doesNotMatch(source, /sessionStorage|localStorage|document\.cookie/u);

console.log("Web demo analytics tests passed.");
