import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { runPeptideTask } from "../apps/desktop/src/lib/workbench/peptide-task";
import { buildPeptideGeometry } from "../apps/desktop/src/lib/molecular-workbench/peptide-geometry";
import { peptideMmcif } from "../apps/desktop/src/lib/molecular-workbench/peptide-mmcif";
const require = createRequire(import.meta.url);
const { CIF } = require("@molstar/io/reader/cif");
const { trajectoryFromMmCIF } = require("@molstar/model/formats/structure/mmcif");
const { Structure, StructureElement, StructureProperties: P } = require("@molstar/model/model/structure");

test("real worker normalizes native codes and retains the exact deterministic full-graph CIF", async () => {
  const options = { phi: -87, psi: 143, chirality: "D" as const, chain: "7", nTerminus: "ammonium" as const, cTerminus: "carboxylate" as const };
  const expected = buildPeptideGeometry("WIPG", options);
  const a = await runPeptideTask({ sequence: "trp-ile PRO gly", codes: "three", options });
  const b = await runPeptideTask({ sequence: "wi pg", codes: "one", options });
  expect(a).toEqual(b);
  const { graph, ...summary } = a;
  expect(summary).toEqual({ cif: peptideMmcif(expected), sequence: "WIPG", atomCount: expected.atoms.length, residueCount: 4, charge: 0 });
  const parsed = await CIF.parse(a.cif).run(); expect(parsed.isError).toBe(false);
  const model = (await trajectoryFromMmCIF(parsed.result.blocks[0]).run()).representative;
  const structure = Structure.ofModel(model);
  expect(structure.elementCount).toBe(expected.atoms.length);
  expect(structure.units.reduce((sum: number, unit: { bonds: { edgeCount: number } }) => sum + unit.bonds.edgeCount, 0) + structure.interUnitBonds.edgeCount).toBe(expected.bonds.length);
  // The insertion graph is the CIF Mol* reads: rows, elements, charges, coordinates and bonds.
  const loc = StructureElement.Location.create(structure), rows: { element: string; charge: number; position: number[] }[] = [], bonds: string[] = [];
  for (const unit of structure.units) {
    const offset = rows.length;
    for (let i = 0; i < unit.elements.length; i++) { loc.unit = unit; loc.element = unit.elements[i]; rows.push({ element: P.atom.type_symbol(loc), charge: P.atom.pdbx_formal_charge(loc), position: [P.atom.x(loc), P.atom.y(loc), P.atom.z(loc)] }); }
    const { a: from, b: to, edgeProps } = unit.bonds;
    for (let e = 0; e < from.length; e++) if (from[e] < to[e]) bonds.push(`${offset + from[e]}:${offset + to[e]}:${edgeProps.order[e]}`);
  }
  expect(graph.atoms.map(({ element, charge }) => ({ element, charge }))).toEqual(rows.map(({ element, charge }) => ({ element, charge })));
  graph.atoms.forEach(({ x, y, z }, i) => [x, y, z].forEach((value, k) => expect(Math.abs(value - rows[i].position[k])).toBeLessThan(1e-5)));
  expect(graph.bonds.map(({ a, b, order }) => `${Math.min(a, b)}:${Math.max(a, b)}:${order}`).sort()).toEqual(bonds.sort());
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
