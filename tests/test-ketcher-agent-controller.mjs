#!/usr/bin/env node
import assert from "node:assert/strict";

import { KETCHER_AGENT_API_VERSION, KETCHER_AGENT_LIMITS } from "../packages/ketcher-agent-contract/index.mjs";
import { KetcherAgentController } from "../apps/desktop/src/lib/ketcher-agent.ts";

const EMPTY_MOLFILE = "\n  Ketcher\n\n  0  0  0  0  0  0            999 V2000\nM  END\n";
const ETHANOL_MOLFILE = [
  "",
  "  Ketcher",
  "",
  "  3  2  0  0  0  0            999 V2000",
  "    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
  "    1.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
  "    2.0000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0",
  "  1  2  1  0",
  "  2  3  1  0",
  "M  END",
  "",
].join("\n");

function fakeEditor() {
  const calls = [];
  let content = "";
  return {
    calls,
    getKet: async () => JSON.stringify({ content }),
    getMolfile: async () => content ? ETHANOL_MOLFILE : EMPTY_MOLFILE,
    getSmiles: async () => content ? "CCO" : "",
    setMolecule: async (value) => { calls.push(["setMolecule", value]); content = value; },
    setMolfile: async (value) => { calls.push(["setMolfile", value]); content = value; },
    subscribeChange: () => () => undefined,
  };
}

let actionCounter = 0;
function action(controller, command, fields = {}) {
  actionCounter += 1;
  return {
    apiVersion: KETCHER_AGENT_API_VERSION,
    type: "control_ketcher",
    command,
    surfaceId: controller.surfaceId,
    actionId: `act-${actionCounter}`,
    expectedRevision: controller.snapshot().structureRevision,
    ...fields,
  };
}

async function readyController(host) {
  const editor = fakeEditor();
  const controller = new KetcherAgentController(`tab-${actionCounter}`, editor, host);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(controller.snapshot().phase, "ready");
  return { controller, editor };
}

// `smi` is accepted as the SMILES format name used by burette_open_viewer.
{
  const { controller, editor } = await readyController();
  const set = await controller.execute(action(controller, "set_structure", { format: "smi", content: "CCO" }));
  assert.equal(set.ok, true, JSON.stringify(set.error));
  assert.deepEqual(editor.calls, [["setMolecule", "CCO"]]);
  assert.equal(set.snapshot.structureRevision, 1);
  const exported = await controller.execute(action(controller, "get_structure", { formats: ["smi"] }));
  assert.deepEqual(exported.result, { delivery: "inline", formats: { smiles: "CCO" } });
}

// Revision conflicts say whether the expected revision is stale or ahead.
{
  const { controller } = await readyController();
  await controller.execute(action(controller, "set_structure", { format: "smiles", content: "CCO" }));
  await controller.execute(action(controller, "set_structure", { format: "smiles", content: "CCN" }));
  const ahead = await controller.execute(action(controller, "clear_structure", { expectedRevision: 99 }));
  assert.equal(ahead.error.code, "REVISION_CONFLICT");
  assert.match(ahead.error.message, /expectedRevision 99 is ahead of the current structure revision 2/);
  assert.doesNotMatch(ahead.error.message, /stale/);
  const stale = await controller.execute(action(controller, "clear_structure", { expectedRevision: 1 }));
  assert.equal(stale.error.code, "REVISION_CONFLICT");
  assert.match(stale.error.message, /expectedRevision 1 is stale; the current structure revision is 2/);
}

// Artifact delivery is rejected instead of returning inline data labelled as an artifact.
{
  const { controller } = await readyController();
  await controller.execute(action(controller, "set_structure", { format: "smiles", content: "CCO" }));
  for (const delivery of ["artifact", "download"]) {
    const result = await controller.execute(action(controller, "get_structure", { formats: ["mol"], delivery }));
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "TRANSPORT_UNAVAILABLE");
    assert.match(result.error.message, new RegExp(`delivery "${delivery}" is not available`));
    assert.equal(result.result, undefined);
    assert.equal(result.snapshot.phase, "ready");
  }
}

// contentRef reads local structure files through the host reader, bounded to 1 MiB.
{
  const reads = [];
  const files = new Map([["/data/nad.mol", ETHANOL_MOLFILE]]);
  const host = {
    readContentRef: async (path, maxBytes) => {
      reads.push([path, maxBytes]);
      if (path.startsWith("/private/")) throw new Error('{"error":"Forbidden"}');
      if (path === "/data/huge.mol") return { content: "x".repeat(16), byteCount: maxBytes * 2, truncated: true };
      if (!files.has(path)) throw new Error(`${path}: No such file or directory (os error 2)`);
      const content = files.get(path);
      return { content, byteCount: content.length, truncated: false };
    },
  };
  const { controller, editor } = await readyController(host);
  const loaded = await controller.execute(action(controller, "set_structure", { format: "mol", contentRef: "/data/nad.mol" }));
  assert.equal(loaded.ok, true, JSON.stringify(loaded.error));
  assert.deepEqual(editor.calls, [["setMolfile", ETHANOL_MOLFILE]]);
  assert.deepEqual(reads, [["/data/nad.mol", KETCHER_AGENT_LIMITS.referencedStructureBytes]]);
  assert.equal(loaded.snapshot.structure.atomCount, 3);

  const fromUrl = await controller.execute(action(controller, "set_structure", { format: "mol", contentRef: "file:///data/nad.mol" }));
  assert.equal(fromUrl.ok, true, JSON.stringify(fromUrl.error));
  assert.equal(reads.at(-1)[0], "/data/nad.mol");

  const revision = controller.snapshot().structureRevision;
  const rejected = [
    [{ format: "mol", contentRef: "nad.mol" }, "INVALID_INPUT", /absolute local file path/],
    [{ format: "mol", contentRef: "/data/../etc/nad.mol" }, "INVALID_INPUT", /absolute local file path/],
    [{ format: "mol", contentRef: "https://example.com/nad.mol" }, "INVALID_INPUT", /absolute local file path/],
    [{ format: "mol", contentRef: "/data/nad.pdb" }, "UNSUPPORTED_FORMAT", /\.mol, \.sdf, \.sd, \.mdl/],
    [{ format: "mol", contentRef: "/private/secret.mol" }, "INVALID_INPUT", /outside the files this workspace is authorized to read/],
    [{ format: "mol", contentRef: "/data/missing.mol" }, "INVALID_INPUT", /contentRef could not be read: \/data\/missing\.mol/],
    [{ format: "mol", contentRef: "/data/huge.mol" }, "PAYLOAD_TOO_LARGE", /1 MiB/],
  ];
  for (const [fields, code, message] of rejected) {
    const result = await controller.execute(action(controller, "set_structure", fields));
    assert.equal(result.ok, false, fields.contentRef);
    assert.equal(result.error.code, code, fields.contentRef);
    assert.match(result.error.message, message, fields.contentRef);
    assert.equal(result.snapshot.phase, "ready");
    assert.equal(result.snapshot.structureRevision, revision);
  }
  assert.equal(editor.calls.length, 2, "rejected references must never reach the editor");

  const { controller: hostless } = await readyController({});
  const unavailable = await hostless.execute(action(hostless, "set_structure", { format: "mol", contentRef: "/data/nad.mol" }));
  assert.equal(unavailable.error.code, "TRANSPORT_UNAVAILABLE");
}

// request_persist waits for the user; only the UI-side confirm writes and advances persistedRevision.
{
  const { controller } = await readyController();
  await controller.execute(action(controller, "set_structure", { format: "smiles", content: "CCO" }));
  const requested = await controller.execute(action(controller, "request_persist", { format: "mol", suggestedBasename: "nad" }));
  assert.equal(requested.ok, true);
  assert.deepEqual(requested.result, { status: "awaiting_user", format: "mol", suggestedBasename: "nad", fileName: "nad.mol", requestedRevision: 1 });
  assert.equal(requested.snapshot.persistRequest.status, "awaiting_user");
  assert.equal(requested.snapshot.persistedRevision, 0);
  assert.equal(requested.snapshot.dirty, true);

  const forged = await controller.execute(action(controller, "confirm_persist"));
  assert.equal(forged.error.code, "INVALID_INPUT");
  const smuggled = await controller.execute(action(controller, "request_persist", { format: "mol", confirmed: true }));
  assert.equal(smuggled.error.code, "INVALID_INPUT");
  assert.equal(controller.getPersistRequest().status, "awaiting_user");

  const writes = [];
  await controller.confirmPersist(async (file) => {
    writes.push(file);
    assert.equal(controller.getPersistRequest().status, "saving");
    return { status: "saved", path: "/Users/me/nad.mol" };
  });
  assert.deepEqual(writes, [{ fileName: "nad.mol", extension: "mol", text: ETHANOL_MOLFILE }]);
  const saved = controller.snapshot();
  assert.equal(saved.persistedRevision, 1);
  assert.equal(saved.dirty, false);
  assert.deepEqual(saved.persistRequest, {
    actionId: requested.actionId,
    status: "saved",
    format: "mol",
    suggestedBasename: "nad",
    fileName: "nad.mol",
    requestedRevision: 1,
    persistedRevision: 1,
    savedPath: "/Users/me/nad.mol",
    error: null,
  });

  await controller.confirmPersist(async () => assert.fail("a finished request must not be written twice"));

  const renamed = await controller.execute(action(controller, "request_persist", { format: "smi", suggestedBasename: "ethanol.smi" }));
  assert.equal(renamed.result.fileName, "ethanol.smi");
  assert.equal(renamed.result.format, "smiles");
  controller.cancelPersist();
  assert.equal(controller.getPersistRequest().status, "cancelled");
  assert.equal(controller.snapshot().lastAction.error.code, "PERSIST_CANCELLED");

  await controller.execute(action(controller, "request_persist", { format: "mol", suggestedBasename: "dialog" }));
  await controller.confirmPersist(async () => ({ status: "cancelled" }));
  assert.equal(controller.getPersistRequest().status, "cancelled");

  await controller.execute(action(controller, "request_persist", { format: "mol", suggestedBasename: "disk" }));
  await controller.confirmPersist(async () => ({ status: "failed", message: "Disk full" }));
  assert.equal(controller.getPersistRequest().status, "failed");
  assert.equal(controller.getPersistRequest().error, "Disk full");
  assert.equal(controller.snapshot().lastAction.error.code, "EXPORT_FAILED");
  assert.equal(controller.snapshot().persistedRevision, 1, "only a saved request advances persistedRevision");
}

console.log("Ketcher agent controller tests passed");
