import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseCifText } from "@molstar/io/reader/cif/text/parser";
import { runAssemblyTask } from "../apps/desktop/src/lib/workbench/assembly-task";

const input = readFileSync(new URL("fixtures/assemblies/two-model.cif", import.meta.url), "utf8");
const built = await Bun.build({ entrypoints: [new URL("../apps/desktop/src/lib/workbench/assembly-worker.ts", import.meta.url).pathname], target: "browser", format: "esm" });
if (!built.success) throw new AggregateError(built.logs, "Assembly worker build failed");
const directory = mkdtempSync(join(tmpdir(), "assembly-worker-")), file = join(directory, "worker.js");
await Bun.write(file, built.outputs[0]);
const NativeWorker = Worker;
let terminated = 0;
class CompiledWorker extends NativeWorker {
  constructor(_url: string | URL, options?: WorkerOptions) { super(pathToFileURL(file), options); }
  override terminate() { terminated++; return super.terminate(); }
}
Object.defineProperty(globalThis, "Worker", { configurable: true, value: CompiledWorker });
afterAll(() => { Object.defineProperty(globalThis, "Worker", { configurable: true, value: NativeWorker }); unlinkSync(file); rmdirSync(directory); });

test("compiled assembly worker lists explicit models and materializes only the chosen model", async () => {
  expect(await runAssemblyTask({ action: "assemblies", text: input, format: "cif" })).toEqual({ assemblies: [{ id: "1", details: "Two translated copies", copies: 2 }], models: ["1", "2"] });
  const output = await runAssemblyTask({ action: "assembly", text: input, format: "cif", assemblyId: "1", modelNumber: "2" });
  const parsed = await parseCifText(output.cif).run(); if (parsed.isError) throw new Error(parsed.message);
  const atoms = parsed.result.blocks[0].categories.atom_site;
  expect({ atoms: output.atomCount, chains: output.chainCount, model: output.modelNumber, warnings: output.warnings,
    rows: Array.from({ length: atoms.rowCount }, (_, i) => [atoms.getField("type_symbol")!.str(i), ...["x", "y", "z"].map(axis => atoms.getField(`Cartn_${axis}`)!.float(i)), atoms.getField("auth_asym_id")!.str(i), atoms.getField("pdbx_PDB_model_num")!.str(i)])
  }).toEqual({ atoms: 2, chains: 2, model: "2", warnings: [], rows: [["C", 21, 2, 3, "Z_A1", "2"], ["C", 26, 2, 3, "Z_A2", "2"]] });
});

test("compiled worker failure, cancellation and timeout terminate; a fresh retry succeeds", async () => {
  const request = { action: "assembly" as const, text: input, format: "cif" as const, assemblyId: "1", modelNumber: "2" };
  await expect(runAssemblyTask({ ...request, modelNumber: "missing" })).rejects.toThrow("Choose one source model");
  const before = terminated, controller = new AbortController(), pending = runAssemblyTask(request, { signal: controller.signal }); controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" }); expect(terminated).toBe(before + 1);
  await expect(runAssemblyTask(request, { signal: AbortSignal.abort() })).rejects.toMatchObject({ name: "AbortError" });
  await expect(runAssemblyTask(request, { timeoutMs: 0 })).rejects.toThrow("time limit");
  expect((await runAssemblyTask(request)).atomCount).toBe(2);
});
