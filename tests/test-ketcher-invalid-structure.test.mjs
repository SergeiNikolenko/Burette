import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { KETCHER_AGENT_API_VERSION } from "../packages/ketcher-agent-contract/index.mjs";
import { KetcherAgentController } from "../apps/desktop/src/lib/ketcher-agent.ts";
import { rejectOnKetcherAsyncFailure } from "../apps/desktop/src/lib/ketcher-async-failure.ts";

function molfile(smiles) {
  const [atoms, bonds] = smiles === "CCO" ? [3, 2] : smiles === "O" ? [1, 0] : [0, 0];
  return `Ketcher\n\n\n${String(atoms).padStart(3)}${String(bonds).padStart(3)}  0  0  0  0            999 V2000\nM  END\n`;
}

test("swallowed parse failure reports INVALID_STRUCTURE, accepts repeated O, preserves it, and recovers to CCO", async () => {
  const eventBus = new EventEmitter();
  let smiles = "";
  let ket = "";
  const editor = {
    getKet: async () => ket,
    getMolfile: async () => molfile(smiles),
    getSmiles: async () => smiles,
    setMolecule: (value) => rejectOnKetcherAsyncFailure(async () => {
      if (value === "C1(") {
        // Mirrors Ketcher core: runAsyncAction logs/emits FAILURE and resolves undefined.
        eventBus.emit("FAILURE");
        return undefined;
      }
      smiles = value === "O" ? "O" : value === "CCO" ? "CCO" : value === "ket:O" ? "O" : "";
      ket = smiles ? `ket:${smiles}` : "";
      eventBus.emit("SUCCESS");
      return undefined;
    }, eventBus),
    setMolfile: async () => undefined,
    subscribeChange: () => () => undefined,
  };
  const controller = new KetcherAgentController("invalid-structure", editor);
  try {
    for (let i = 0; i < 20 && controller.snapshot().phase !== "ready"; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(controller.snapshot().phase, "ready");

    const send = (actionId, expectedRevision, content) => controller.execute({
      apiVersion: KETCHER_AGENT_API_VERSION,
      type: "control_ketcher",
      command: "set_structure",
      surfaceId: controller.surfaceId,
      actionId,
      expectedRevision,
      format: "smiles",
      content,
    });

    const oxygen = await send("oxygen", 0, "O");
    assert.equal(oxygen.ok, true);
    assert.equal(oxygen.snapshot.structure.smiles, "O");
    assert.equal(oxygen.snapshot.structureRevision, 1);

    const sameValid = await send("same-oxygen", 1, "O");
    assert.equal(sameValid.ok, true, "a valid input matching the current structure is still successful");
    assert.equal(sameValid.snapshot.structure.smiles, "O");
    assert.equal(sameValid.snapshot.structureRevision, 2);

    const invalid = await send("invalid-ring", 2, "C1(");
    assert.equal(invalid.ok, false);
    assert.equal(invalid.error.code, "INVALID_STRUCTURE");
    assert.match(invalid.error.message, /could not parse or import/u);
    assert.equal(invalid.snapshot.phase, "ready");
    assert.equal(invalid.snapshot.structure.smiles, "O");
    assert.equal(invalid.snapshot.structureRevision, 2);
    assert.equal(eventBus.listenerCount("FAILURE"), 0, "failure listener must be removed before recovery");

    const recovered = await send("recover-ethanol", 2, "CCO");
    assert.equal(recovered.ok, true);
    assert.equal(recovered.snapshot.structure.smiles, "CCO");
    assert.equal(recovered.snapshot.structureRevision, 3);
  } finally {
    controller.dispose();
  }
});

test("Ketcher failure listener is removed when the wrapped operation rejects", async () => {
  const eventBus = new EventEmitter();
  await assert.rejects(
    rejectOnKetcherAsyncFailure(async () => { throw new Error("unexpected editor failure"); }, eventBus),
    /unexpected editor failure/u,
  );
  assert.equal(eventBus.listenerCount("FAILURE"), 0);
});
