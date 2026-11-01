import { afterEach, expect, test } from "bun:test";
import { createWorkbenchAgentController, type WorkbenchAgentController } from "../apps/desktop/src/lib/workbench/agent-controller";
import { addDocumentInternalCoordinates, releaseClosedImports } from "../apps/desktop/src/lib/workbench/scientific-source-state";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import type { ViewerDocument } from "../apps/desktop/src/types";

const text = "1\nauthored source identity fixture\nH 0 0 0\n";
const controllers: WorkbenchAgentController[] = [];
function fixture() {
  const document: ViewerDocument = { id: crypto.randomUUID(), title: "source.xyz", path: "/source.xyz", extension: "xyz", renderer: "molstar", runtimePath: "/viewer", byteCount: text.length };
  let documents = [document];
  let read = async () => ({ text, origin: "draft" as const });
  const controller = createWorkbenchAgentController({ runtime: "browser-agent-shell", documents: () => documents, activeDocument: () => documents[0], draftsVisible: true, readSource: () => read() });
  controllers.push(controller);
  const science = parseScientificFile("source.xyz", text);
  addDocumentInternalCoordinates(document.id, text, science);
  const observe = () => controller.execute({ type: "workbench", operation: "observe" });
  const revision = async () => { const result = await observe(); if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.result.sourceRevision; };
  return { document, controller, science, observe, revision,
    holdRead(promise: Promise<void>) { read = async () => { await promise; return { text, origin: "draft" }; }; },
    closeAndReopen() { documents = []; controller.documentsChanged(new Set()); documents = [{ ...document }]; controller.documentsChanged(new Set([document.id])); },
  };
}
afterEach(() => { for (const c of controllers.splice(0)) c.dispose(); releaseClosedImports(new Set()); });

test("no-basis attached scientific fields participate in the source revision", async () => {
  const f = fixture();
  const mutations = [
    () => { f.science.frames[0].energyHartree = -1; },
    () => { f.science.frames[0].forcesKcalMolAngstrom = [[1, 2, 3]]; },
    () => { f.science.frames[0].velocitiesAngstromPerPs = [[0.1, 0.2, 0.3]]; },
    () => { f.science.modes = [{ index: 0, frequencyCm1: 100, displacements: [[1, 0, 0]] }]; },
    () => { f.science.grid = { dimensions: [1, 1, 1], origin: [0, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], values: new Float32Array([0.5]) }; },
    () => { f.science.frames[0].hessian = { units: "hartree/bohr^2", dimension: 3, values: new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), source: "orca-hess" }; },
  ];
  let previous = await f.revision();
  for (const mutate of mutations) { mutate(); const next = await f.revision(); expect(next).not.toBe(previous); expect(await f.revision()).toBe(next); previous = next; }
});

test("close and reopen of the same id and bytes retires a held source read", async () => {
  const f = fixture(); let release!: () => void;
  f.holdRead(new Promise<void>(resolve => { release = resolve; }));
  const pending = f.observe(); await Bun.sleep(0); f.closeAndReopen(); release();
  expect(await pending).toMatchObject({ ok: false, error: { code: "SOURCE_CLOSED" } });
  expect(await f.observe()).toMatchObject({ ok: true });
});

test("full scientific payload hashes visible typed-array bytes and captures before digest awaits", async () => {
  const { scientificDocumentPayload } = await import("../apps/desktop/src/lib/science-session/codec");
  const f = fixture(), backing = new Float32Array([99, 0.25, -0.5, 88]);
  f.science.grid = { dimensions: [1, 1, 2], origin: [0, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], values: backing.subarray(1, 3) };
  const payload = scientificDocumentPayload(f.science), copied = payload.clone();
  const hash = payload.sha256(); backing[0] = 77; backing[3] = 66;
  expect(await scientificDocumentPayload(f.science).sha256()).toBe(await hash);
  const captured = scientificDocumentPayload(f.science); const clone = captured.clone(), pending = captured.sha256();
  backing[1] = 0.75;
  expect(clone.grid!.values).toEqual(new Float32Array([0.25, -0.5]));
  expect(await pending).toBe(await scientificDocumentPayload(copied).sha256());
  expect(await scientificDocumentPayload(f.science).sha256()).not.toBe(await pending);
  f.science.grid.values[1] = Infinity;
  await expect(scientificDocumentPayload(f.science).sha256()).rejects.toThrow("non-finite");
});

test("a source observation captures attached data before a held digest and sees the next change", async () => {
  const f = fixture(); f.science.frames[0].energyHartree = -1;
  const before = await f.revision(), originalDigest = crypto.subtle.digest.bind(crypto.subtle);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let held = false;
  crypto.subtle.digest = async (...args: Parameters<SubtleCrypto["digest"]>) => { if (!held) { held = true; await gate; } return originalDigest(...args); };
  try {
    const reading = f.revision();
    for (let i = 0; i < 100 && !held; i++) await Bun.sleep(1);
    expect(held).toBe(true); f.science.frames[0].energyHartree = -2; release();
    expect(await reading).toBe(before);
    expect(await f.revision()).not.toBe(before);
  } finally { release(); crypto.subtle.digest = originalDigest; }
});
