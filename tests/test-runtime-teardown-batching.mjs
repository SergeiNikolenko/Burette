#!/usr/bin/env bun
import assert from "node:assert/strict";
import { mock } from "bun:test";

const calls = [];
let native = true;
let documents = [];
mock.module("react", () => ({ useCallback: callback => callback, useRef: current => ({ current }) }));
mock.module("@tauri-apps/api/core", () => ({ invoke: async (command, args) => { calls.push([command, args]); } }));
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => native }));
mock.module("../apps/desktop/src/stores/molecule-store", () => ({ useMoleculeStore: { getState: () => ({ documents }) } }));

const { useAppHostRuntimeOperations } = await import("../apps/desktop/src/hooks/use-app-host-runtime-operations.ts");
const { closeGridRuntime } = useAppHostRuntimeOperations({ activeDocument: null, pushErrorStatus() {}, pushStatus() {} });

documents = Array.from({ length: 1000 }, (_, i) => ({ id: `pdb-${i}`, extension: "pdb", renderer: "molstar" }));
for (const document of documents) closeGridRuntime(document.id);
await Promise.resolve();
assert.deepEqual(calls, [], "PDB previews cannot own grid runtimes");

documents = Array.from({ length: 1000 }, (_, i) => ({
  id: `grid-${i}`, extension: "sdf", renderer: i % 2 ? "grid2d" : "molstar",
}));
for (const document of documents) {
  closeGridRuntime(document.id);
  closeGridRuntime(document.id);
}
await Promise.resolve();
assert.deepEqual(calls, [["grid_close_runtime", { documentIds: documents.map(document => document.id) }]],
  "one deduplicated batch also releases old grids after switching SDF renderers");

calls.length = 0;
closeGridRuntime("old-runtime-no-longer-in-store");
await Promise.resolve();
assert.deepEqual(calls, [["grid_close_runtime", { documentIds: ["old-runtime-no-longer-in-store"] }]]);

calls.length = 0;
native = false;
closeGridRuntime("grid-0");
await Promise.resolve();
assert.deepEqual(calls, [], "browser-dev keeps its existing runtime ownership");
console.log("runtime teardown batching tests passed");
