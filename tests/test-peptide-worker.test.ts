import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { runPeptideTask } from "../apps/desktop/src/lib/workbench/peptide-task";
import { buildPeptideGeometry } from "../apps/desktop/src/lib/molecular-workbench/peptide-geometry";
import { peptideMmcif } from "../apps/desktop/src/lib/molecular-workbench/peptide-mmcif";
const require = createRequire(import.meta.url);
const { CIF } = require("molstar/lib/commonjs/mol-io/reader/cif.js");
const { trajectoryFromMmCIF } = require("molstar/lib/commonjs/mol-model-formats/structure/mmcif.js");
const { Structure } = require("molstar/lib/commonjs/mol-model/structure.js");

test("real worker normalizes native codes and retains the exact deterministic full-graph CIF", async () => {
  const options = { phi: -87, psi: 143, chirality: "D" as const, chain: "7", nTerminus: "ammonium" as const, cTerminus: "carboxylate" as const };
  const expected = buildPeptideGeometry("WIPG", options);
  const a = await runPeptideTask({ sequence: "trp-ile PRO gly", codes: "three", options });
  const b = await runPeptideTask({ sequence: "wi pg", codes: "one", options });
  expect(a).toEqual(b);
  expect(a).toEqual({ cif: peptideMmcif(expected), sequence: "WIPG", atomCount: expected.atoms.length, residueCount: 4, charge: 0 });
  const parsed = await CIF.parse(a.cif).run(); expect(parsed.isError).toBe(false);
  const model = (await trajectoryFromMmCIF(parsed.result.blocks[0]).run()).representative;
  const structure = Structure.ofModel(model);
  expect(structure.elementCount).toBe(expected.atoms.length);
  expect(structure.units.reduce((sum: number, unit: { bonds: { edgeCount: number } }) => sum + unit.bonds.edgeCount, 0) + structure.interUnitBonds.edgeCount).toBe(expected.bonds.length);
});

test("code style is explicit: ALA means one alanine or the three-residue sequence", async () => {
  expect((await runPeptideTask({ sequence: "ALA", codes: "three", options: {} })).residueCount).toBe(1);
  expect((await runPeptideTask({ sequence: "ALA", codes: "one", options: {} })).residueCount).toBe(3);
  await expect(runPeptideTask({ sequence: "ALA-BAD", codes: "three", options: {} })).rejects.toThrow("three-letter");
  await expect(runPeptideTask({ sequence: "G", codes: "one", options: { phi: 181 } })).rejects.toThrow("angles");
  await expect(runPeptideTask({ sequence: "W".repeat(64), codes: "one", options: {} })).rejects.toThrow("256 atoms");
  await expect(runPeptideTask({ sequence: "A".repeat(1025), codes: "one", options: {} })).rejects.toThrow("64 amino-acid");
});

test("cancelled real workers never return a peptide and a fresh retry succeeds", async () => {
  const controller = new AbortController();
  const pending = runPeptideTask({ sequence: "ACIPGT", codes: "one", options: {} }, { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect((await runPeptideTask({ sequence: "G", codes: "one", options: {} })).residueCount).toBe(1);
});
