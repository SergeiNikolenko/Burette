import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runMetalComplexTask, type MetalComplexBuildRequest } from "../apps/desktop/src/lib/workbench/metal-complex-task";
import type { MetalComplexOptions } from "../apps/desktop/src/lib/molecular-workbench/metal-complex";
import { parseMolecule } from "../apps/desktop/src/lib/molecular-workbench/molecular-graph";
import complexes from "./fixtures/metal-complex/complexes.json";
import reference from "./fixtures/metal-complex/reference.json";

const sample = (id: string) => readFileSync(new URL(`fixtures/metal-complex/samples/${id}.sdf`, import.meta.url), "utf8");

test("real worker returns the RDKit-verified SDF and a typed graph; MOL output is the same record without the terminator", async () => {
  const options = complexes["tris-bpy-ruthenium"].options as MetalComplexOptions, rdkit = reference.complexes["tris-bpy-ruthenium"].rdkit;
  const result = await runMetalComplexTask({ ...options, format: "sdf" });
  expect({ ...result, graph: undefined }).toEqual({ text: sample("tris-bpy-ruthenium"), format: "sdf", name: "[Ru(bpy)3]2+", atomCount: rdkit.atoms, bondCount: rdkit.bonds,
    formula: "C30H24N6Ru", charge: rdkit.charge, coordinationNumber: rdkit.dative, geometry: "octahedral", graph: undefined });
  expect(result.graph.coordination.every(edge => edge.b === 0 && result.graph.atoms[edge.a].element === "N")).toBe(true);
  expect(result.graph.atoms.reduce((sum, atom) => sum + atom.charge, 0)).toBe(result.charge);
  const mol = await runMetalComplexTask({ ...options, format: "mol" });
  expect(mol.text).toBe(result.text.replace(/\$\$\$\$\n$/u, ""));
  expect(parseMolecule(mol.text, "mol").atoms).toHaveLength(result.atomCount);
});

test("worker refusals surface as named errors and a cancelled build never returns", async () => {
  const cisplatin = complexes.cisplatin.options as MetalComplexOptions;
  await expect(runMetalComplexTask({ ...cisplatin, format: "pdb" } as unknown as MetalComplexBuildRequest)).rejects.toThrow("SDF or MOL");
  await expect(runMetalComplexTask({ ...cisplatin, ligands: cisplatin.ligands.slice(1), format: "sdf" })).rejects.toThrow("every square planar site");
  await expect(runMetalComplexTask({ ...cisplatin, ligands: Array.from({ length: 9 }, () => cisplatin.ligands[0]), format: "sdf" })).rejects.toThrow("at most 8");
  const controller = new AbortController();
  const pending = runMetalComplexTask({ ...cisplatin, format: "sdf" }, { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect((await runMetalComplexTask({ ...cisplatin, format: "sdf" })).text).toBe(sample("cisplatin"));
});
