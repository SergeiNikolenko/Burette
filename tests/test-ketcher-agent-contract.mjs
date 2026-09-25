import assert from "node:assert/strict";
import {
  KETCHER_AGENT_API_VERSION,
  applyInteractionRevision,
  applyStructuralRevision,
  createKetcherSnapshot,
  createRevisionState,
  markPersisted,
  validateKetcherAction,
} from "../packages/ketcher-agent-contract/index.mjs";

const initial = createRevisionState("desktop-ketcher:tab-1", "ready");
assert.equal(initial.dirty, false);
const edited = applyStructuralRevision(initial);
assert.equal(edited.structureRevision, 1);
assert.equal(edited.interactionRevision, 1);
assert.equal(edited.dirty, true);
assert.equal(markPersisted(edited, 0).dirty, true);
assert.equal(markPersisted(edited, 1).dirty, false);
assert.equal(applyInteractionRevision(edited).structureRevision, 1);

const valid = validateKetcherAction({
  apiVersion: KETCHER_AGENT_API_VERSION,
  type: "control_ketcher",
  command: "set_structure",
  surfaceId: "desktop-ketcher:tab-1",
  actionId: "act-1",
  expectedRevision: 1,
  format: "smiles",
  content: "CCO",
});
assert.equal(valid.ok, true);
assert.equal(valid.value.input.format, "smiles");
assert.equal(validateKetcherAction({ ...valid.value, apiVersion: "burette-ketcher-agent/v0" }).ok, false);
assert.equal(validateKetcherAction({ ...valid.value, unexpected: true }).ok, false);
assert.equal(validateKetcherAction({ ...valid.value, content: "x".repeat(65537) }).ok, false);
assert.equal(validateKetcherAction({
  type: "control_ketcher",
  command: "highlight_atoms",
  surfaceId: "desktop-ketcher:tab-1",
  actionId: "act-2",
  expectedRevision: 1,
  indexes: [2, 0, 1],
}).value.indexes.join(","), "0,1,2");

const snapshot = createKetcherSnapshot({
  state: edited,
  structure: { kind: "molecule", atomCount: 3, bondCount: 2, componentCount: 1, smiles: "CCO" },
  selectedAtoms: Array.from({ length: 300 }, (_, index) => index),
  highlightedAtoms: [2],
  capabilities: { setStructure: true, highlightAtoms: true, getStructure: true, persist: true },
});
assert.equal(snapshot.apiVersion, KETCHER_AGENT_API_VERSION);
assert.equal(snapshot.selectedAtoms.length, 256);
assert.equal(snapshot.selectedAtomCount, 300);
assert.equal(snapshot.selectionTruncated, true);
assert.equal(snapshot.structure.smiles, "CCO");
assert.equal(Object.hasOwn(snapshot, "persistRequest"), false, "surfaces without a save flow keep the original snapshot shape");
const persistRequest = { actionId: "act-3", status: "awaiting_user" };
assert.deepEqual(createKetcherSnapshot({ state: edited, persistRequest }).persistRequest, persistRequest);
assert.equal(createKetcherSnapshot({ state: edited, persistRequest: null }).persistRequest, null);

// `smi` (the burette_open_viewer name) is an alias for `smiles` in every format field.
const base = { type: "control_ketcher", surfaceId: "desktop-ketcher:tab-1", actionId: "act-4", expectedRevision: 1 };
assert.equal(validateKetcherAction({ ...base, command: "set_structure", format: " SMI ", content: "CCO" }).value.input.format, "smiles");
assert.deepEqual(validateKetcherAction({ ...base, command: "get_structure", formats: ["smi", "smiles", "mol"] }).value.formats, ["smiles", "mol"]);
assert.equal(validateKetcherAction({ ...base, command: "request_persist", format: "smi" }).value.format, "smiles");
assert.equal(validateKetcherAction({ ...base, command: "set_structure", format: "smiles2", content: "CCO" }).error.code, "UNSUPPORTED_FORMAT");
console.log("ketcher agent contract tests passed");
