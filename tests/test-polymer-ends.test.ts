import { afterAll, beforeAll, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import initRDKitModule, { type MainModule } from "@rdkit/rdkit";
import { buildBrowserWorker } from "./support/browser-worker-build";
import { preparePolymerRequest, runPolymerTask, type PolymerEnds } from "../apps/desktop/src/lib/workbench/polymer-task";
import { sdfFromGraph } from "../apps/desktop/src/lib/workbench/formats";
import { parseMolecule } from "../apps/desktop/src/lib/molecular-workbench/molecular-graph";
import type { MolecularAtom, MolecularBond } from "../apps/desktop/src/lib/molecular-workbench/types";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/polymer/propylene-reference.json", import.meta.url), "utf8")) as { atoms: MolecularAtom[]; bonds: MolecularBond[]; roles: { head: number; tail: number; headLeaving: number; tailLeaving: number } };
const references = JSON.parse(readFileSync(new URL("./fixtures/polymer/tacticity-references.json", import.meta.url), "utf8")).references as { name: string; smiles: string }[];
const text = sdfFromGraph(fixture.atoms, fixture.bonds, "Propylene");
const built = await buildBrowserWorker(new URL("../apps/desktop/src/lib/workbench/polymer-worker.ts", import.meta.url));
const directory = mkdtempSync(join(tmpdir(), "polymer-ends-"));
const file = join(directory, "apps/desktop/src/lib/workbench/worker.js");
const wasm = join(directory, "PreviewExtension/Web/rdkit-conformer/Burette_rdkit_conformer.wasm");
// Preserve the worker-relative asset layout used by the browser's MMFF evaluator.
mkdirSync(dirname(file), { recursive: true });
mkdirSync(dirname(wasm), { recursive: true });
copyFileSync(new URL("../PreviewExtension/Web/rdkit-conformer/Burette_rdkit_conformer.wasm", import.meta.url), wasm);
await Bun.write(file, built.outputs[0]);
const NativeWorker = Worker;
class CompiledWorker extends NativeWorker { constructor(_url: string | URL, options?: WorkerOptions) { super(pathToFileURL(file), options); } }
Object.defineProperty(globalThis, "Worker", { configurable: true, value: CompiledWorker });
afterAll(() => { Object.defineProperty(globalThis, "Worker", { configurable: true, value: NativeWorker }); rmSync(directory, { recursive: true, force: true }); });
let rdkit: MainModule;
beforeAll(async () => { rdkit = await initRDKitModule(); });
const canonical = (input: string) => { const mol = rdkit.get_mol(input, JSON.stringify({ removeHs: true })); if (!mol) throw new Error("RDKit could not read the molecule."); try { return mol.get_smiles(); } finally { mol.delete(); } };
const build = (tacticity: "isotactic" | "syndiotactic", ends?: PolymerEnds, relax = false, count = 6) =>
  runPolymerTask(preparePolymerRequest({ text, format: "sdf" }, { ...fixture.roles, count, bondLength: 1.54, tacticity, ends, relax }));
// The frozen hydrogen-capped references start at the first head carbon and end with the final tail H,
// so a cap is the group's SMILES written before the first atom and in place of that last [H].
const capped = (smiles: string, head: string, tail: string) => `${head}${smiles.replace(/\[H\]$/u, tail)}`;

for (const [ends, head, tail] of [[{ head: "methyl", tail: "methyl" }, "C", "C"], [{ head: "hydroxyl", tail: "phenyl" }, "O", "c1ccccc1"], [{ head: "hydrogen", tail: "tert-butyl" }, "", "C(C)(C)C"]] as const) {
  test(`${ends.head}/${ends.tail} ends replace the terminal hydrogens and keep the tacticity of the frozen references`, async () => {
    for (const reference of references.filter(item => item.name === "isotactic" || item.name === "syndiotactic")) {
      const result = await build(reference.name as "isotactic" | "syndiotactic", ends);
      expect(canonical(result.sdf)).toBe(canonical(capped(reference.smiles, head, tail)));
      const graph = parseMolecule(result.sdf, "sdf");
      expect(result.atomCount).toBe(graph.atoms.length);
      expect(result.sourceAtomIndices).toHaveLength(graph.atoms.length);
      expect(result.sourceAtomIndices.filter(i => i < 0).length).toBe(graph.atoms.length - 56 + (head ? 1 : 0) + (tail === "[H]" ? 0 : 1));
    }
  });
}

test("relaxation lowers the MMFF94 energy toward reference bond lengths without changing the graph or stereochemistry", async () => {
  const isotactic = references.find(item => item.name === "isotactic")!;
  const start = await build("isotactic"), relaxed = await build("isotactic", undefined, true);
  expect(start.relaxation).toBeUndefined();
  expect(relaxed.relaxation!.energy).toBeLessThan(relaxed.relaxation!.initialEnergy);
  expect(relaxed.relaxation!.converged).toBe(true);
  expect(canonical(relaxed.sdf)).toBe(canonical(isotactic.smiles));
  const graph = parseMolecule(relaxed.sdf, "sdf"), original = parseMolecule(start.sdf, "sdf");
  expect(graph.bonds).toEqual(original.bonds);
  // Csp3-Csp3 1.530 A and C-H (methyl/methylene, neutron) 1.092 A: Allen et al., J. Chem. Soc. Perkin Trans. 2 1987, S1.
  const lengths = (element: string) => graph.bonds.filter(bond => [graph.atoms[bond.a].element, graph.atoms[bond.b].element].sort().join("") === element)
    .map(bond => Math.hypot(graph.atoms[bond.a].x - graph.atoms[bond.b].x, graph.atoms[bond.a].y - graph.atoms[bond.b].y, graph.atoms[bond.a].z - graph.atoms[bond.b].z));
  for (const length of lengths("CC")) expect(Math.abs(length - 1.530)).toBeLessThan(0.025);
  for (const length of lengths("CH")) expect(Math.abs(length - 1.092)).toBeLessThan(0.02);
  await expect(build("isotactic", undefined, true, 30)).rejects.toThrow("up to 256 atoms");
  // A bulky head cap on the unrelaxed chain end would sit 1.2 A from a branch hydrogen; it is refused, not placed.
  await expect(build("isotactic", { head: "tert-butyl", tail: "hydrogen" })).rejects.toThrow("overlaps");
});
