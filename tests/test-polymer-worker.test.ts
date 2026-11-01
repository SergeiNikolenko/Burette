import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { preparePolymerRequest, runPolymerTask } from "../apps/desktop/src/lib/workbench/polymer-task";
import { sdfFromGraph } from "../apps/desktop/src/lib/workbench/formats";
import fixture from "./fixtures/polymer/propylene-reference.json";
const require = createRequire(import.meta.url);
const { parseMol } = require("@molstar/io/reader/mol/parser");
const { trajectoryFromMol } = require("@molstar/model/formats/structure/mol");
const { Structure } = require("@molstar/model/model/structure");
async function native(text: string) {
  const parsed = await parseMol(text).run(); if (parsed.isError) throw new Error(parsed.message);
  return Structure.ofModel((await trajectoryFromMol(parsed.result).run()).representative);
}
const text = sdfFromGraph(fixture.atoms, fixture.bonds, "Propylene");
const settings = { head: 0, tail: 1, headLeaving: 5, tailLeaving: 4, count: 6, bondLength: 3, tacticity: "atactic" as const };
const built = await Bun.build({ entrypoints: [new URL("../apps/desktop/src/lib/workbench/polymer-worker.ts", import.meta.url).pathname], target: "browser", format: "esm" });
if (!built.success) throw new AggregateError(built.logs, "Polymer worker build failed");
const directory = mkdtempSync(join(tmpdir(), "polymer-worker-")), file = join(directory, "worker.js");
await Bun.write(file, built.outputs[0]);
const NativeWorker = Worker;
let terminated = 0;
class CompiledWorker extends NativeWorker {
  constructor(_url: string | URL, options?: WorkerOptions) { super(pathToFileURL(file), options); }
  override terminate() { terminated++; return super.terminate(); }
}
Object.defineProperty(globalThis, "Worker", { configurable: true, value: CompiledWorker });
afterAll(() => { Object.defineProperty(globalThis, "Worker", { configurable: true, value: NativeWorker }); unlinkSync(file); rmdirSync(directory); });

test("prepared atactic request owns one entropy sample and exact repeated worker output", async () => {
  const entropy = crypto.getRandomValues.bind(crypto); let calls = 0;
  const previous = Object.getOwnPropertyDescriptor(crypto, "getRandomValues");
  Object.defineProperty(crypto, "getRandomValues", { configurable: true, value: (array: Uint8Array) => { calls++; return entropy(array); } });
  try {
    const mutable = { ...settings }, request = preparePolymerRequest({ text, format: "sdf" }, mutable); mutable.count = 2;
    const result = await runPolymerTask(request), retry = await runPolymerTask(request);
    expect(calls).toBe(1); expect(result).toEqual(retry);
    expect([result.atomCount, result.bondCount, request.options.count]).toEqual([56, 55, 6]);
    expect(result.repeatAlternatives).toEqual(request.options.tacticity?.kind === "atactic" ? request.options.tacticity.alternatives : []);
    expect(Object.isFrozen(request) && Object.isFrozen(request.options) && Object.isFrozen(request.options.tacticity) && Object.isFrozen(request.options.tacticity?.kind === "atactic" && request.options.tacticity.alternatives)).toBe(true);
    const reopened = await runPolymerTask({ action: "source", text: result.sdf, format: "sdf" });
    expect([reopened.atoms.length, reopened.bonds.length]).toEqual([56, 55]);
    const structure = await native(result.sdf), edges: string[] = [];
    for (const unit of structure.units) for (let i = 0; i < unit.bonds.a.length; i++) if (unit.bonds.a[i] < unit.bonds.b[i]) {
      const source = unit.model.atomicHierarchy.atomSourceIndex;
      edges.push(`${[source.value(unit.elements[unit.bonds.a[i]]), source.value(unit.elements[unit.bonds.b[i]])].sort((a, b) => a - b).join(":")}:${unit.bonds.edgeProps.order[i]}`);
    }
    expect(structure.elementCount).toBe(56); expect(structure.interUnitBonds.edgeCount).toBe(0);
    expect(edges.sort()).toEqual(reopened.bonds.map(b => `${[b.a, b.b].sort((a, b) => a - b).join(":")}:${b.order}`).sort());
    expect(reopened.atoms.map(a => a.element)).toEqual(result.sourceAtomIndices.map(i => fixture.atoms[i].element));
  } finally { if (previous) Object.defineProperty(crypto, "getRandomValues", previous); else Reflect.deleteProperty(crypto, "getRandomValues"); }
});

test("worker source rows survive interleaved explicit H, atom and bond reordering", async () => {
  const permutation = [7, 2, 5, 0, 9, 3, 8, 1, 4, 10, 6];
  const atoms = permutation.map(i => fixture.atoms[i]);
  const bonds = [...fixture.bonds].reverse().map(b => ({ a: permutation.indexOf(b.b), b: permutation.indexOf(b.a), order: b.order }));
  const sourceText = sdfFromGraph(atoms, bonds, "Reordered"), source = await runPolymerTask({ action: "source", text: sourceText, format: "sdf" });
  expect(source.atoms).toEqual(atoms.map(a => ({ element: a.element, x: Number(a.x.toFixed(4)), y: Number(a.y.toFixed(4)), z: Number(a.z.toFixed(4)) })));
  const structure = await native(sourceText);
  for (const unit of structure.units) for (const index of unit.elements) {
    const sourceIndex = unit.model.atomicHierarchy.atomSourceIndex.value(index), expected = source.atoms[sourceIndex];
    expect(unit.model.atomicHierarchy.atoms.type_symbol.value(index)).toBe(expected.element);
    for (const axis of ["x", "y", "z"] as const) expect(unit.model.atomicConformation[axis][index]).toBeCloseTo(expected[axis], 5);
  }
  const result = await runPolymerTask(preparePolymerRequest({ text: sourceText, format: "sdf" }, { ...settings, tacticity: "syndiotactic", head: permutation.indexOf(0), tail: permutation.indexOf(1), headLeaving: permutation.indexOf(5), tailLeaving: permutation.indexOf(4) }));
  expect([result.atomCount, result.bondCount, result.repeatAlternatives]).toEqual([56, 55, [0, 1, 0, 1, 0, 1]]);
});

test("actual parser refuses unsupported atom metadata, extra records and bounded input", async () => {
  for (const [line, reason] of [["M  CHG  1   1   1", "formal charges"], ["M  ISO  1   1  13", "isotope labels"], ["M  RAD  1   1   2", "radicals"]]) {
    for (const action of ["source", "build"] as const) {
      const request = preparePolymerRequest({ text: text.replace("M  END", `${line}\nM  END`), format: "sdf" }, settings);
      await expect(runPolymerTask({ ...request, action })).rejects.toThrow(reason);
    }
  }
  await expect(runPolymerTask({ action: "source", text: text + text, format: "sdf" })).rejects.toThrow("one SDF record");
  await expect(runPolymerTask({ action: "source", text: "é".repeat(1_000_001), format: "sdf" })).rejects.toThrow("2 MB");
});

test("real worker abort and timeout terminate, and the identical request can retry", async () => {
  const request = preparePolymerRequest({ text, format: "sdf" }, settings), before = terminated, controller = new AbortController();
  const pending = runPolymerTask(request, { signal: controller.signal }); controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" }); expect(terminated).toBe(before + 1);
  await expect(runPolymerTask(request, { timeoutMs: 0 })).rejects.toThrow("time limit");
  expect((await runPolymerTask(request)).repeatAlternatives).toEqual(request.options.tacticity?.kind === "atactic" ? request.options.tacticity.alternatives : []);
});
