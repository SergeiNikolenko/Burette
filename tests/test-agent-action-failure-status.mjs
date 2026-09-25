#!/usr/bin/env bun
// A failed viewer action must be reported as what it is. Only "no such atoms"
// failures read as a structure mismatch; stale revisions, a missing viewer and
// invalid or out-of-range arguments get a generic title with their own code.
import assert from "node:assert/strict";
import { mock } from "bun:test";

mock.module("react", () => ({ useCallback: (callback) => callback }));
const { useAppViewerHostMessages } = await import("../apps/desktop/src/hooks/use-app-viewer-host-messages.ts");

const statuses = [];
const { handleViewerHostMessage } = useAppViewerHostMessages({
  pendingMolstarReplaceRef: { current: new Map() },
  pushStatus: (message, kind, details) => statuses.push({ message, kind, details }),
});
const report = (result, id = "agent-1") => {
  statuses.length = 0;
  assert.equal(handleViewerHostMessage("burette-agent-viewer", { type: "agent-action-result", id, result }), true);
  return statuses.slice();
};

assert.deepEqual(report({ ok: true, command: "focusLigand" }), []);
assert.deepEqual(report({ ok: false, command: "focusLigand", error: { code: "SELECTION_EMPTY", message: "Ligand selector matched no ligands." } }), [{
  message: "Structure action did not match the structure",
  kind: "error",
  details: ["Ligand selector matched no ligands.", "focusLigand: SELECTION_EMPTY"],
}]);
for (const [command, code, message] of [
  ["patchSceneLayers", "STALE_REVISION", "The scene changed; repeat the query."],
  ["set_structure_pose", "INDEX_OUT_OF_RANGE", "Frame index 2 is out of range; this structure has 2 frames (valid indices 0–1)."],
  ["focus_ligand", "NO_VIEWER", "BuretteAgent is not available in this viewer runtime."],
  ["capture_scene", "INVALID_ARGS", "Capture scope must be auto, scene or ligand."],
]) {
  assert.deepEqual(report({ ok: false, command, error: { code, message } }), [{
    message: "Structure action failed",
    kind: "error",
    details: [message, `${command}: ${code}`],
  }], code);
}
assert.deepEqual(report({ ok: false }), [{ message: "Structure action failed", kind: "error", details: ["The viewer did not report a reason"] }]);
assert.deepEqual(report({ ok: false, error: { code: "INVALID_ARGS" } }, "text-selection-1"), []);

console.log("Agent action failure status contracts passed");
