import assert from "node:assert/strict";
import { mock } from "bun:test";

const calls = [];
let native = true;
let adopted = [];
let onAbort = () => {};
mock.module("@tauri-apps/api/core", () => ({ invoke: async (command, args) => {
  calls.push([command, args]);
  if (command === "abort_open_document_claim") onAbort();
} }));
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => native }));
mock.module("../apps/desktop/src/stores/molecule-store", () => ({ useMoleculeStore: { getState: () => ({ documents: adopted }) } }));
const { abortOpenDocumentClaims } = await import("../apps/desktop/src/lib/open-document-claims.ts");

const oldGrid = { id: "combined-old", virtual: true, renderer: "grid2d" };
const cancelledGrid = { id: "combined-cancelled", virtual: true, renderer: "grid2d" };
adopted = [oldGrid];
await abortOpenDocumentClaims([oldGrid, cancelledGrid, cancelledGrid, { id: "file-grid", renderer: "grid2d" }]);
assert.deepEqual(calls, [["grid_close_runtime", { documentIds: ["combined-cancelled"] }]],
  "a cancelled derived result releases only its unique runtime, leaving adopted and file grids alone");

calls.length = 0;
onAbort = () => { adopted = [oldGrid, cancelledGrid]; };
await abortOpenDocumentClaims([{ openClaimId: "claim" }, { openClaimId: "claim" }, cancelledGrid]);
assert.deepEqual(calls, [["abort_open_document_claim", { claimId: "claim" }]],
  "adoption is rechecked after asynchronous claim cleanup, and claims are deduplicated");

calls.length = 0;
native = false;
adopted = [];
await abortOpenDocumentClaims([cancelledGrid]);
assert.deepEqual(calls, [], "browser-derived collections cannot release native runtimes");
console.log("open document claim and cancelled virtual grid ownership tests passed");
