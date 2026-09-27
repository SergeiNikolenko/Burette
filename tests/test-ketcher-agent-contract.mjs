import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { z } from "zod";
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
// The public tool must reject misrouted actions before the generic viewer
// fallback can turn an editor request into a misleading NO_VIEWER error.
const registration = readFileSync(new URL("../plugins/burette-agent/mcp/registrations/molecular-workspace/register.mjs", import.meta.url), "utf8");
const schemaSource = registration.slice(registration.indexOf("const ketcherActionSchema ="), registration.indexOf("const OBSERVE_ARRAY_LIMIT"));
const toolSchema = runInNewContext(schemaSource + "; ketcherActionSchema", { z });
const toolAction = { apiVersion: KETCHER_AGENT_API_VERSION, type: "control_ketcher", command: "set_structure", surfaceId: "test", expectedRevision: 0, format: "smiles", content: "CCO" };
assert.equal(toolSchema.safeParse(toolAction).success, true);
assert.equal(toolSchema.safeParse({ ...toolAction, type: "set_structure" }).success, false);
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
console.log("ketcher agent contract tests passed");
