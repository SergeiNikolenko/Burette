import assert from "node:assert/strict";
import { test, afterAll, afterEach } from "bun:test";
import { Window } from "happy-dom";
import type { ShellActions } from "../apps/desktop/src/components/types";
import type { ViewerDocument } from "../apps/desktop/src/types";
import type { ScientificDocument } from "../apps/desktop/src/lib/molecular-workbench/scientific-types";

type OpenRecords = ShellActions["openStructureRecords"];
type RecordInput = Parameters<OpenRecords>[0][number];
const browser = new Window({ url: "http://localhost/" }), previous = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator, localStorage: browser.localStorage })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
afterAll(async () => {
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
  await browser.happyDOM.close();
});
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { openGeneratedStructure, openScientificDocument } = await import("../apps/desktop/src/lib/workbench/generated-document-open");
const { scientificStateFor, importedOriginalFor, registeredRevision, releaseClosedImports } = await import("../apps/desktop/src/lib/workbench/scientific-source-state");
const { parseXyz } = await import("../apps/desktop/src/lib/molecular-workbench/xyz");
const atom = (x: number) => ({ element: "He", x, y: 0, z: 0 });
const data = (): ScientificDocument => ({ format: "fchk", atoms: [atom(2)], frames: [{ atoms: [atom(0)], energyHartree: -1, modes: [{ index: 0, frequencyCm1: 12 }] }, { atoms: [atom(2)], energyHartree: -2 }], modes: [{ index: 0, frequencyCm1: 32 }], orbitals: [{ index: 0, energyHartree: -0.5, occupancy: 2, spin: "alpha", coefficients: [1] }], converged: true });
let serial = 0;
const add = (record: RecordInput): ViewerDocument => {
  const path = `/generated-${++serial}.xyz`;
  const document: ViewerDocument = { id: `generated-${serial}`, path, runtimePath: path, title: record.path, extension: record.inputExtension, renderer: "molstar", byteCount: new TextEncoder().encode(record.text).byteLength };
  useMoleculeStore.setState(state => ({ documents: [...state.documents, document] }));
  return document;
};
afterEach(() => { releaseClosedImports(new Set()); useMoleculeStore.setState({ documents: [] }); });

test("generated records retain their content, safe name and cancellation predicate", async () => {
  const shouldApply = () => false, seen: Parameters<OpenRecords>[] = [];
  const actions: Pick<ShellActions, "openStructureRecords"> = { openStructureRecords: async (...args) => { seen.push(args); return []; } };
  await openGeneratedStructure(actions, "../../bad:name.log", "sdf", "EXACT\nTEXT", shouldApply);
  assert.deepEqual(seen[0], [[{ path: "bad_name.sdf", inputExtension: "sdf", text: "EXACT\nTEXT" }], undefined, { shouldApply }]);
  await openGeneratedStructure(actions, "plain", "xyz", "XYZ");
  assert.deepEqual(seen[1], [[{ path: "plain.xyz", inputExtension: "xyz", text: "XYZ" }]]);
});

test("overlapping same-name parsed imports keep their own original and complete final data", async () => {
  const scienceA = data(), scienceB = data(), fileA = new Blob([new Uint8Array([239,187,191]), "A\r\n"]), fileB = new Blob(["B"]);
  const firstResult: { record?: RecordInput; document?: ViewerDocument } = {}, secondResult: typeof firstResult = {};
  let finishA: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { finishA = resolve; });
  const first = openScientificDocument({ openStructureRecords: async records => { firstResult.record = records[0]; await gate; firstResult.document = add(records[0]); return [firstResult.document]; } }, "same.fchk", scienceA, "final", { name: "same.fchk", file: fileA });
  await openScientificDocument({ openStructureRecords: async records => { secondResult.record = records[0]; secondResult.document = add(records[0]); return [secondResult.document]; } }, "same.fchk", scienceB, "final", { name: "same.fchk", file: fileB });
  assert.ok(finishA); finishA(); await first;
  const { record: recordA, document: documentA } = firstResult, { record: recordB, document: documentB } = secondResult;
  assert.ok(recordA && recordB && documentA && documentB);
  assert.equal(recordA.path, "same.xyz"); assert.equal(recordB.path, "same.xyz"); assert.notEqual(recordA.text, recordB.text);
  assert.deepEqual(parseXyz(recordA.text).atoms, scienceA.atoms);
  assert.equal(scientificStateFor(documentA.id, recordA.text).revision?.document, scienceA);
  assert.equal(scientificStateFor(documentB.id, recordB.text).revision?.document, scienceB);
  const originalA = importedOriginalFor(documentA.id), originalB = importedOriginalFor(documentB.id);
  assert.ok(originalA && originalB); assert.equal(originalA.file, fileA); assert.equal(originalB.file, fileB);
  assert.deepEqual([...new Uint8Array(await originalA.file.arrayBuffer())], [239,187,191,65,13,10]);
  releaseClosedImports(new Set([documentB.id]));
  assert.equal(importedOriginalFor(documentA.id), null); assert.equal(importedOriginalFor(documentB.id)?.file, fileB);
});

test("steps preserve frame geometry, energies and frame modes while final-only data stays final", async () => {
  const science = data(); let result: { record: RecordInput; document: ViewerDocument } | undefined;
  await openScientificDocument({ openStructureRecords: async records => { const document = add(records[0]); result = { record: records[0], document }; return [document]; } }, "optimization", science, "steps");
  assert.ok(result); const { record, document } = result, lines = record.text.trimEnd().split("\n");
  assert.deepEqual([parseXyz(lines.slice(0,3).join("\n")).atoms, parseXyz(lines.slice(3,6).join("\n")).atoms], science.frames.map(frame => frame.atoms));
  assert.match(lines[1], /^Step 1 Energy=-1 Hartree import-/); assert.equal(lines[4], "Step 2 Energy=-2 Hartree");
  assert.deepEqual(scientificStateFor(document.id, record.text).revision?.document, { format: science.format, atoms: science.frames[0].atoms, frames: science.frames, modes: [], orbitals: [], converged: true });
});

test("failed, empty, ambiguous and already-closed opens release only their own registration", async () => {
  for (const outcome of ["throw", "empty", "multiple", "closed"] as const) {
    let record: RecordInput | undefined;
    const open = openScientificDocument({ openStructureRecords: async records => {
      record = records[0];
      if (outcome === "throw") throw new Error("Open rejected");
      const document = add(record);
      if (outcome === "empty") return [];
      if (outcome === "multiple") return [document, add(record)];
      useMoleculeStore.setState(state => ({ documents: state.documents.filter(item => item.id !== document.id) }));
      releaseClosedImports(new Set(useMoleculeStore.getState().documents.map(item => item.id)));
      return [document];
    } }, "discard.fchk", data(), "final", { name: "discard.fchk", file: new Blob([outcome]) });
    if (outcome === "throw") await assert.rejects(open, /Open rejected/); else await open;
    assert.ok(record); assert.equal(registeredRevision("later-document", record.text), null);
  }
});
