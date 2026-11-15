import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runNucleicTask, type NucleicBuildRequest } from "../apps/desktop/src/lib/workbench/nucleic-task";
const require = createRequire(import.meta.url);
const { CIF } = require("@molstar/io/reader/cif");
const { trajectoryFromMmCIF } = require("@molstar/model/formats/structure/mmcif");
const { Structure } = require("@molstar/model/model/structure");

// The real module worker, as the dialog and automation run it. Counts and formulas come from
// RDKit's sequence molecules (tests/fixtures/nucleic/rdkit-references.json), not from the builder.
const RDKIT: { cases: { type: string; fivePrime: string; strands: string; sequence: string; formula: string; charge: number; atoms: number }[] } =
  JSON.parse(readFileSync(new URL("./fixtures/nucleic/rdkit-references.json", import.meta.url), "utf8"));
const reference = (sequence: string, fivePrime: string, strands: string) => RDKIT.cases.find((item) => item.sequence === sequence && item.fivePrime === fivePrime && item.strands === strands)!;
const hill = (atoms: { element: string }[]) => {
  const counts = new Map<string, number>();
  for (const atom of atoms) counts.set(atom.element, (counts.get(atom.element) ?? 0) + 1);
  return ["C", "H", ...[...counts.keys()].filter((element) => element !== "C" && element !== "H").sort()].map((element) => `${element}${counts.get(element)}`).join("");
};

test("the worker returns readable mmCIF, its counts and charge, and the explicit graph in row order", async () => {
  const request: NucleicBuildRequest = { sequence: "cac gtg", options: { type: "DNA", form: "Z", strands: "double", fivePrime: "phosphate" } };
  const result = await runNucleicTask(request);
  const expected = reference("CACGTG", "phosphate", "double");
  expect({ ...result, text: result.text.split("\n")[0], graph: undefined }).toEqual({
    text: "data_CACGTG-Z-DNA-duplex-ideal", format: "mmcif", name: "CACGTG-Z-DNA-duplex-ideal", sequence: "CACGTG", atomCount: expected.atoms,
    residueCount: 12, charge: expected.charge, strands: [{ chain: "A", sequence: "CACGTG" }, { chain: "B", sequence: "CACGTG" }], graph: undefined,
  });
  expect([hill(result.graph.atoms), result.graph.atoms.reduce((sum, atom) => sum + atom.charge, 0)]).toEqual([expected.formula.replace(/[+-]\d*$/u, ""), expected.charge]);
  const parsed = await CIF.parse(result.text).run();
  const structure = Structure.ofModel((await trajectoryFromMmCIF(parsed.result.blocks[0]).run()).representative);
  expect(structure.elementCount).toBe(result.graph.atoms.length);
  // Mol* rows are the graph rows: same coordinates in the same order, the same bond count.
  const rows = result.text.split("\n").filter((line) => line.startsWith("ATOM ")).map((line) => line.split(" ").slice(10, 13).map(Number));
  expect(rows).toEqual(result.graph.atoms.map((atom) => [atom.x, atom.y, atom.z].map((value) => Number((Math.abs(value) < 5e-4 ? 0 : value).toFixed(3)))));
  expect(structure.units.reduce((sum: number, unit: { bonds: { edgeCount: number } }) => sum + unit.bonds.edgeCount, 0)).toBe(result.graph.bonds.length);
  expect(new Set(result.graph.bonds.map((bond) => bond.order))).toEqual(new Set([1, 2]));
});

test("invalid requests fail in the worker with the user's message", async () => {
  const dna = { type: "DNA", form: "B", strands: "double", fivePrime: "hydroxyl" } as const;
  await expect(runNucleicTask({ sequence: "ACGU", options: dna })).rejects.toThrow("U is an RNA base. Use T, or choose RNA.");
  await expect(runNucleicTask({ sequence: "ACGU", options: { ...dna, type: "RNA" } })).rejects.toThrow("RNA is built only as an A-form helix.");
  await expect(runNucleicTask({ sequence: "GATTACA", options: { ...dna, form: "Z" } })).rejects.toThrow("Z-DNA needs alternating pyrimidines and purines");
  await expect(runNucleicTask({ sequence: "A".repeat(501), options: dna })).rejects.toThrow("Use at most 500 nucleotides per strand.");
  await expect(runNucleicTask({ sequence: "A".repeat(4001), options: dna })).rejects.toThrow("Use at most 500 nucleotides per strand.");
});

test("the longest duplex finishes in the worker; cancel terminates a build and a retry succeeds", async () => {
  const longest = { sequence: "ACGT".repeat(125), options: { type: "DNA", form: "B", strands: "double", fivePrime: "phosphate" } } as const;
  const started = performance.now();
  const result = await runNucleicTask(longest);
  expect([result.residueCount, result.atomCount < 35_000, performance.now() - started < 10_000]).toEqual([1000, true, true]);
  const controller = new AbortController();
  const running = runNucleicTask(longest, { signal: controller.signal });
  controller.abort();
  await expect(running).rejects.toMatchObject({ name: "AbortError" });
  expect((await runNucleicTask({ sequence: "G", options: { ...longest.options, strands: "single" } })).residueCount).toBe(1);
});
